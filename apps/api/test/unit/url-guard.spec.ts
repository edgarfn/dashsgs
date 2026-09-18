import {
  assertSafeErpUrl,
  classificarIp,
  ipv4InCidr,
} from '../../src/integration/sg/http/url-guard';

/**
 * Guarda anti-SSRF (doc 09 §3 — API7). É o teste mais importante da integração: o `base_url` é
 * digitado pelo cliente e o nosso servidor vai buscá-lo. Cada caso abaixo é um ataque real.
 */
describe('classificação de IP', () => {
  it.each([
    ['loopback v4', '127.0.0.1'],
    ['loopback disfarçado', '127.127.127.127'],
    ['metadata de nuvem', '169.254.169.254'],
    ['privado 10/8', '10.0.0.5'],
    ['privado 172.16/12', '172.20.10.1'],
    ['privado 192.168/16', '192.168.0.1'],
    ['CGNAT', '100.64.0.1'],
    ['este host', '0.0.0.0'],
    ['multicast', '224.0.0.1'],
    ['loopback v6', '::1'],
    ['unique local v6', 'fd00::1'],
    ['link-local v6', 'fe80::1'],
    ['v4 mapeado em v6', '::ffff:127.0.0.1'],
  ])('bloqueia %s', (_caso, ip) => {
    expect(classificarIp(ip).publico).toBe(false);
  });

  it.each([
    ['IP público v4', '8.8.8.8'],
    ['IP público v4 alto', '200.147.35.149'],
    ['IP público v6', '2606:4700::6810:85e5'],
  ])('libera %s', (_caso, ip) => {
    expect(classificarIp(ip).publico).toBe(true);
  });

  it('calcula CIDR corretamente nas bordas', () => {
    expect(ipv4InCidr('172.15.255.255', '172.16.0.0/12')).toBe(false);
    expect(ipv4InCidr('172.16.0.0', '172.16.0.0/12')).toBe(true);
    expect(ipv4InCidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
    expect(ipv4InCidr('172.32.0.0', '172.16.0.0/12')).toBe(false);
  });
});

describe('assertSafeErpUrl', () => {
  const https = { tlsMode: 'https' as const, allowInsecure: false };

  it.each([
    ['sem esquema', 'erp.example.com'],
    ['esquema de arquivo', 'file:///etc/passwd'],
    ['gopher', 'gopher://example.com'],
    ['texto solto', 'não é uma url'],
  ])('recusa endereço malformado: %s', async (_caso, url) => {
    await expect(assertSafeErpUrl(url, https)).rejects.toThrow();
  });

  it('recusa credencial embutida na URL', async () => {
    await expect(assertSafeErpUrl('https://usuario:senha@example.com', https)).rejects.toThrow();
  });

  it('recusa host que resolve para rede interna', async () => {
    await expect(assertSafeErpUrl('http://127.0.0.1:8201', https)).rejects.toThrow();
    await expect(assertSafeErpUrl('https://169.254.169.254', https)).rejects.toThrow();
    await expect(assertSafeErpUrl('https://[::1]:8201', https)).rejects.toThrow();
  });

  it('recusa HTTP quando o modo é https e a flag de dev está desligada', async () => {
    await expect(assertSafeErpUrl('http://example.com:8201', https)).rejects.toThrow(
      'HTTP sem TLS',
    );
  });

  it('aceita HTTP em dev/homologação apenas com a flag explícita', async () => {
    const resultado = await assertSafeErpUrl('http://example.com:8201', {
      tlsMode: 'https',
      allowInsecure: true,
    });
    expect(resultado.url.hostname).toBe('example.com');
    expect(resultado.ips.length).toBeGreaterThan(0);
  });

  it('aceita HTTPS público', async () => {
    const resultado = await assertSafeErpUrl('https://example.com', https);
    expect(resultado.url.protocol).toBe('https:');
  });

  describe('modo VPN', () => {
    const vpn = { tlsMode: 'vpn' as const, allowInsecure: false, vpnCidr: '10.66.0.0/16' };

    it('aceita IP privado dentro da faixa do túnel', async () => {
      const resultado = await assertSafeErpUrl('http://10.66.3.7:8201', vpn);
      expect(resultado.ips).toEqual(['10.66.3.7']);
    });

    it('recusa IP privado fora da faixa do túnel', async () => {
      await expect(assertSafeErpUrl('http://10.0.0.5:8201', vpn)).rejects.toThrow('faixa do túnel');
      await expect(assertSafeErpUrl('http://192.168.1.10', vpn)).rejects.toThrow('faixa do túnel');
    });

    it('respeita a faixa configurada pela operação, não uma constante do código', async () => {
      // A rede do túnel é decisão de infraestrutura (runbook 22 §7): trocá-la é mudar SG_VPN_CIDR.
      const outraFaixa = { ...vpn, vpnCidr: '10.200.0.0/16' };

      const resultado = await assertSafeErpUrl('http://10.200.1.9:8201', outraFaixa);
      expect(resultado.ips).toEqual(['10.200.1.9']);

      await expect(assertSafeErpUrl('http://10.66.3.7:8201', outraFaixa)).rejects.toThrow(
        '10.200.0.0/16',
      );
    });

    it('continua recusando loopback e metadata mesmo no modo VPN', async () => {
      await expect(assertSafeErpUrl('http://127.0.0.1', vpn)).rejects.toThrow();
      await expect(assertSafeErpUrl('http://169.254.169.254', vpn)).rejects.toThrow();
    });

    /**
     * Regressão do furo que a auditoria do doc 34 Q1 encontrou.
     *
     * O laço de IPs aceitava qualquer endereço **público** com um `continue` antes de chegar à
     * checagem de faixa, e a regra de protocolo só exige TLS quando o modo é `https`. A
     * combinação aceitava `http://host-publico` em modo VPN: credencial do ERP e dados de venda
     * em claro na internet, com a auditoria gravando `tls_mode=vpn` — que se lê como "cifrado".
     *
     * No modo VPN o sigilo vem do túnel; logo, o destino tem de estar DENTRO dele. Endereço
     * público neste modo é configuração errada, com ou sem TLS.
     */
    it('recusa endereço público no modo VPN — o túnel é que cifra', async () => {
      await expect(assertSafeErpUrl('http://example.com:8201', vpn)).rejects.toThrow(
        'faixa do túnel',
      );
      await expect(assertSafeErpUrl('https://example.com', vpn)).rejects.toThrow('faixa do túnel');
    });

    it('aceita mais de uma faixa de túnel na mesma instalação', async () => {
      // Uma instalação pode acabar com dois túneis; um CIDR único obrigaria mudar código para
      // atender o segundo (doc 34 Q1).
      const dois = {
        tlsMode: 'vpn' as const,
        allowInsecure: false,
        vpnCidrs: ['10.66.0.0/16', '10.77.0.0/16'],
      };

      expect((await assertSafeErpUrl('http://10.66.3.7:8201', dois)).ips).toEqual(['10.66.3.7']);
      expect((await assertSafeErpUrl('http://10.77.1.2:8201', dois)).ips).toEqual(['10.77.1.2']);
      await expect(assertSafeErpUrl('http://10.88.1.2:8201', dois)).rejects.toThrow(
        'faixa do túnel',
      );
    });
  });

  it('recusa host inexistente com mensagem acionável', async () => {
    await expect(
      assertSafeErpUrl('https://este-host-nao-existe-dashsgs-teste.invalid', https),
    ).rejects.toThrow('não resolve');
  });
});

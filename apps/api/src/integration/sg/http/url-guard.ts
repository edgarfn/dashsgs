import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppException } from '../../../common/errors/app.exception';

/**
 * Guarda anti-SSRF do `base_url` (doc 09 §3 — API7).
 *
 * O endereço do ERP é **configurado pelo tenant**: é uma URL que o nosso servidor vai buscar. Sem
 * validação, isso é SSRF de manual — bastaria apontar para `169.254.169.254` e ler credenciais da
 * nuvem, ou para `127.0.0.1:6379` e conversar com o nosso próprio Redis.
 *
 * A verificação acontece duas vezes de propósito: ao salvar a conexão e **antes de cada
 * requisição**. Só a primeira deixaria a porta aberta para DNS rebinding — o domínio resolve para
 * um IP público no cadastro e para `127.0.0.1` na hora do uso.
 */

/** Faixas privadas, de loopback, link-local e metadata de nuvem. */
const IPV4_BLOQUEADAS: Array<{ cidr: string; motivo: string }> = [
  { cidr: '0.0.0.0/8', motivo: 'endereço "este host"' },
  { cidr: '10.0.0.0/8', motivo: 'rede privada' },
  { cidr: '100.64.0.0/10', motivo: 'CGNAT' },
  { cidr: '127.0.0.0/8', motivo: 'loopback' },
  { cidr: '169.254.0.0/16', motivo: 'link-local (inclui metadata de nuvem)' },
  { cidr: '172.16.0.0/12', motivo: 'rede privada' },
  { cidr: '192.0.0.0/24', motivo: 'reservado IETF' },
  { cidr: '192.168.0.0/16', motivo: 'rede privada' },
  { cidr: '198.18.0.0/15', motivo: 'benchmark' },
  { cidr: '224.0.0.0/4', motivo: 'multicast' },
  { cidr: '240.0.0.0/4', motivo: 'reservado' },
];

export interface UrlGuardOptions {
  /** `vpn` aceita IP privado — mas só dentro da faixa do túnel (runbook 22 §7). */
  tlsMode: 'https' | 'vpn';
  /** Liberado apenas em dev/homologação, nunca em produção (contrato de ambiente, doc 19 §3). */
  allowInsecure: boolean;
  /** Faixa do túnel WireGuard provisionado pela plataforma. */
  vpnCidr?: string;
}

export interface UrlGuardResult {
  url: URL;
  /** IPs para os quais o host resolveu no momento da verificação. */
  ips: string[];
}

function ipv4ToLong(ip: string): number {
  return ip.split('.').reduce((total, octeto) => total * 256 + Number(octeto), 0);
}

export function ipv4InCidr(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const mascara = bits === '0' ? 0 : (-1 << (32 - Number(bits))) >>> 0;
  return (ipv4ToLong(ip) & mascara) === (ipv4ToLong(base as string) & mascara);
}

/** Um IP é "de rede interna" quando cai em qualquer faixa não roteável na internet. */
export function classificarIp(ip: string): { publico: boolean; motivo?: string } {
  const versao = isIP(ip);

  if (versao === 4) {
    const faixa = IPV4_BLOQUEADAS.find((entrada) => ipv4InCidr(ip, entrada.cidr));
    return faixa ? { publico: false, motivo: faixa.motivo } : { publico: true };
  }

  if (versao === 6) {
    const normalizado = ip.toLowerCase();
    // IPv4 mapeado (::ffff:127.0.0.1) esconde um endereço v4 — desembrulha antes de julgar.
    const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalizado);
    if (mapeado?.[1]) return classificarIp(mapeado[1]);

    if (normalizado === '::1') return { publico: false, motivo: 'loopback' };
    if (normalizado === '::') return { publico: false, motivo: 'endereço não especificado' };
    if (/^f[cd]/.test(normalizado)) return { publico: false, motivo: 'unique local (fc00::/7)' };
    if (/^fe[89ab]/.test(normalizado)) return { publico: false, motivo: 'link-local (fe80::/10)' };
    if (/^ff/.test(normalizado)) return { publico: false, motivo: 'multicast' };
    return { publico: true };
  }

  return { publico: false, motivo: 'não é um endereço IP' };
}

const recusa = (mensagem: string, contexto: Record<string, unknown>): AppException =>
  new AppException('VALIDATION_ERROR', {
    message: mensagem,
    details: [{ path: 'baseUrl', rule: 'ssrf_guard' }],
    logContext: contexto,
  });

/**
 * Valida o endereço e resolve o host. Lança `VALIDATION_ERROR` com mensagem explicativa — este é
 * um erro de configuração que alguém precisa corrigir, não uma falha interna.
 */
export async function assertSafeErpUrl(
  raw: string,
  options: UrlGuardOptions,
): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw recusa('Endereço inválido. Use uma URL completa, como https://erp.suarede.com.br', {
      raw,
    });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw recusa('Apenas http(s) é aceito no endereço do ERP.', { protocol: url.protocol });
  }

  // Credencial na URL vaza em log e histórico de navegador; a senha tem lugar próprio.
  if (url.username || url.password) {
    throw recusa('Não coloque usuário ou senha no endereço.', { host: url.hostname });
  }

  if (url.protocol === 'http:' && options.tlsMode === 'https' && !options.allowInsecure) {
    throw recusa(
      'HTTP sem TLS é recusado. Use HTTPS ou solicite a provisão de VPN para este tenant.',
      { host: url.hostname },
    );
  }

  const ips = await resolverHost(url.hostname);
  if (ips.length === 0) {
    throw recusa('O endereço não resolve para nenhum IP. Confira o DNS.', { host: url.hostname });
  }

  for (const ip of ips) {
    const { publico, motivo } = classificarIp(ip);

    if (publico) continue;

    // Modo VPN: endereço privado é esperado, mas só dentro do túnel que a plataforma provisiona.
    if (options.tlsMode === 'vpn') {
      const cidr = options.vpnCidr ?? '10.66.0.0/16';
      if (isIP(ip) === 4 && ipv4InCidr(ip, cidr)) continue;
      throw recusa(`No modo VPN o endereço precisa estar na faixa do túnel (${cidr}).`, {
        ip,
        motivo,
      });
    }

    throw recusa('O endereço aponta para uma rede interna. Informe o endereço público do ERP.', {
      ip,
      motivo,
    });
  }

  return { url, ips };
}

async function resolverHost(hostname: string): Promise<string[]> {
  // Host já é um IP literal: não há DNS para consultar.
  if (isIP(hostname) !== 0) return [hostname];

  try {
    const enderecos = await lookup(hostname, { all: true, verbatim: true });
    return enderecos.map((entrada) => entrada.address);
  } catch {
    return [];
  }
}

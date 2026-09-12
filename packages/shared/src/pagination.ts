/** Paginação da API interna (doc 23): `?page=&pageSize=`. */
export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
}

export const PAGE_DEFAULT = 1;
export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

export function buildPaginated<T>(
  data: T[],
  totalItems: number,
  { page, pageSize }: PageQuery,
): Paginated<T> {
  return {
    data,
    page,
    pageSize,
    totalItems,
    totalPages: pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0,
  };
}

export const MAX_ORDERED_LIST_NUMBER = 2_147_483_647;

export function isSupportedOrderedListNumber(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) <= MAX_ORDERED_LIST_NUMBER;
}

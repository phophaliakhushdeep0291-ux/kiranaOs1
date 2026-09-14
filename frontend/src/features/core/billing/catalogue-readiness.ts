/** React Query reports placeholder [] as success while the first read runs. */
export function shouldWaitForBillingCatalogue(query: { isLoading: boolean; isPlaceholderData: boolean; isFetching: boolean }, productCount: number) {
  return productCount === 0 && (query.isLoading || (query.isPlaceholderData && query.isFetching));
}

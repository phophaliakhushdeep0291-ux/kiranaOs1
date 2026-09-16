/** Bound the IN list and consume one batch at a time. Branch reads only need
 * that branch; the primary location needs all allocations to compute its share. */
export async function* readLocationProductStockBatches(client, shopId, location, products) {
  const batchSize = 1000;
  for (let at = 0; at < products.length; at += batchSize) {
    const productIds = products.slice(at, at + batchSize).map((product) => product.id);
    yield await client.locationStock.findMany({
      where: {
        shopId,
        productId: { in: productIds },
        sellingUnitId: null,
        ...(!location.isPrimary && { locationId: location.id }),
      },
      select: { locationId: true, productId: true, stockBaseQty: true, lowStockThreshold: true },
    });
  }
}

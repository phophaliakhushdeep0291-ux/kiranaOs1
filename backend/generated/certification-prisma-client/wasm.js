
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.14.0
 * Query Engine version: e9771e62de70f79a5e1c604a2d7c8e2a0a874b48
 */
Prisma.prismaVersion = {
  client: "5.14.0",
  engine: "e9771e62de70f79a5e1c604a2d7c8e2a0a874b48"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}

/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  Serializable: 'Serializable'
});

exports.Prisma.ShopScalarFieldEnum = {
  id: 'id',
  name: 'name',
  ownerName: 'ownerName',
  city: 'city',
  address: 'address',
  gstNumber: 'gstNumber',
  phone: 'phone',
  settingsJson: 'settingsJson',
  dataEpoch: 'dataEpoch',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ShopMaintenanceLockScalarFieldEnum = {
  shopId: 'shopId',
  tokenHash: 'tokenHash',
  reason: 'reason',
  lockedByUserId: 'lockedByUserId',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PricingRuleScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  description: 'description',
  ruleType: 'ruleType',
  status: 'status',
  priority: 'priority',
  productId: 'productId',
  locationId: 'locationId',
  unitCode: 'unitCode',
  sellingUnitId: 'sellingUnitId',
  customerId: 'customerId',
  customerGroup: 'customerGroup',
  minQuantity: 'minQuantity',
  maxQuantity: 'maxQuantity',
  fixedUnitPrice: 'fixedUnitPrice',
  adjustmentType: 'adjustmentType',
  adjustmentValue: 'adjustmentValue',
  minimumMarginPercent: 'minimumMarginPercent',
  paymentMethod: 'paymentMethod',
  combinePolicy: 'combinePolicy',
  validFrom: 'validFrom',
  validUntil: 'validUntil',
  requiresOwnerApproval: 'requiresOwnerApproval',
  createdByUserId: 'createdByUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProductSellingUnitScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  productId: 'productId',
  name: 'name',
  unitType: 'unitType',
  unitCode: 'unitCode',
  packSizeValue: 'packSizeValue',
  packSizeUnit: 'packSizeUnit',
  conversionToBase: 'conversionToBase',
  barcode: 'barcode',
  sku: 'sku',
  defaultPrice: 'defaultPrice',
  defaultPricePaise: 'defaultPricePaise',
  minimumPrice: 'minimumPrice',
  minimumPricePaise: 'minimumPricePaise',
  maximumPrice: 'maximumPrice',
  maximumPricePaise: 'maximumPricePaise',
  costPrice: 'costPrice',
  costPricePaise: 'costPricePaise',
  onHandQty: 'onHandQty',
  lowStockThreshold: 'lowStockThreshold',
  reorderLevel: 'reorderLevel',
  variantValue1: 'variantValue1',
  variantValue2: 'variantValue2',
  isDefault: 'isDefault',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PricingDecisionEventScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  billId: 'billId',
  billItemId: 'billItemId',
  productId: 'productId',
  sellingUnitId: 'sellingUnitId',
  customerId: 'customerId',
  customerGroup: 'customerGroup',
  quantity: 'quantity',
  productCost: 'productCost',
  productCostPaise: 'productCostPaise',
  defaultPrice: 'defaultPrice',
  defaultPricePaise: 'defaultPricePaise',
  recommendedPrice: 'recommendedPrice',
  recommendedPricePaise: 'recommendedPricePaise',
  finalAcceptedPrice: 'finalAcceptedPrice',
  finalAcceptedPricePaise: 'finalAcceptedPricePaise',
  appliedRuleId: 'appliedRuleId',
  recommendationSource: 'recommendationSource',
  confidence: 'confidence',
  wasOverridden: 'wasOverridden',
  overrideReason: 'overrideReason',
  reusableDecision: 'reusableDecision',
  oneTimeSpecialPrice: 'oneTimeSpecialPrice',
  excludedFromLearning: 'excludedFromLearning',
  exclusionReason: 'exclusionReason',
  decidedByUserId: 'decidedByUserId',
  deviceId: 'deviceId',
  createdAt: 'createdAt'
};

exports.Prisma.CustomerOrderScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  customerName: 'customerName',
  customerMobile: 'customerMobile',
  customerAddress: 'customerAddress',
  itemsJson: 'itemsJson',
  itemCount: 'itemCount',
  estimatedTotal: 'estimatedTotal',
  note: 'note',
  fulfillmentType: 'fulfillmentType',
  promisedSlot: 'promisedSlot',
  tableId: 'tableId',
  tableName: 'tableName',
  guestCount: 'guestCount',
  sourceChannel: 'sourceChannel',
  externalOrderId: 'externalOrderId',
  paymentStatus: 'paymentStatus',
  fulfillmentStatus: 'fulfillmentStatus',
  status: 'status',
  billId: 'billId',
  idempotencyKey: 'idempotencyKey',
  acceptanceKey: 'acceptanceKey',
  acceptedAt: 'acceptedAt',
  readyAt: 'readyAt',
  fulfilledAt: 'fulfilledAt',
  rejectedAt: 'rejectedAt',
  cancelledAt: 'cancelledAt',
  feedbackRating: 'feedbackRating',
  feedbackComment: 'feedbackComment',
  feedbackAt: 'feedbackAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RestaurantGuestRequestScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  tableId: 'tableId',
  tableCode: 'tableCode',
  tableName: 'tableName',
  orderId: 'orderId',
  type: 'type',
  reason: 'reason',
  splitMode: 'splitMode',
  status: 'status',
  requestedAt: 'requestedAt',
  acknowledgedAt: 'acknowledgedAt',
  completedAt: 'completedAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BillCounterScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  lastNumber: 'lastNumber',
  estimateLastNumber: 'estimateLastNumber',
  returnLastNumber: 'returnLastNumber',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  mobile: 'mobile',
  email: 'email',
  emailVerifiedAt: 'emailVerifiedAt',
  googleSub: 'googleSub',
  passwordHash: 'passwordHash',
  role: 'role',
  pinHash: 'pinHash',
  disabledAt: 'disabledAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuthTokenScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  shopId: 'shopId',
  type: 'type',
  tokenHash: 'tokenHash',
  sentToEmail: 'sentToEmail',
  expiresAt: 'expiresAt',
  consumedAt: 'consumedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SessionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  shopId: 'shopId',
  deviceId: 'deviceId',
  deviceRecordId: 'deviceRecordId',
  deviceSessionVersion: 'deviceSessionVersion',
  tokenFamily: 'tokenFamily',
  refreshTokenHash: 'refreshTokenHash',
  userAgent: 'userAgent',
  ipAddress: 'ipAddress',
  expiresAt: 'expiresAt',
  revokedAt: 'revokedAt',
  revokedReason: 'revokedReason',
  lastUsedAt: 'lastUsedAt',
  createdAt: 'createdAt'
};

exports.Prisma.ProductScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  category: 'category',
  aliasesJson: 'aliasesJson',
  displayUnit: 'displayUnit',
  baseUnit: 'baseUnit',
  rateUnit: 'rateUnit',
  stockBaseQty: 'stockBaseQty',
  stockTrackingEnabled: 'stockTrackingEnabled',
  costPerRateUnit: 'costPerRateUnit',
  costPerRateUnitPaise: 'costPerRateUnitPaise',
  minPricePerRateUnit: 'minPricePerRateUnit',
  minPricePerRateUnitPaise: 'minPricePerRateUnitPaise',
  defaultPricePerRateUnit: 'defaultPricePerRateUnit',
  defaultPricePerRateUnitPaise: 'defaultPricePerRateUnitPaise',
  retailPricePerRateUnit: 'retailPricePerRateUnit',
  retailFromQuantity: 'retailFromQuantity',
  wholesalePricePerRateUnit: 'wholesalePricePerRateUnit',
  wholesaleFromQuantity: 'wholesaleFromQuantity',
  gstRate: 'gstRate',
  hsn: 'hsn',
  barcode: 'barcode',
  sku: 'sku',
  brand: 'brand',
  mrp: 'mrp',
  reorderLevel: 'reorderLevel',
  description: 'description',
  imageUrl: 'imageUrl',
  isLooseItem: 'isLooseItem',
  lowStockThreshold: 'lowStockThreshold',
  packagingMode: 'packagingMode',
  variantAxesJson: 'variantAxesJson',
  batchTrackingEnabled: 'batchTrackingEnabled',
  drugSchedule: 'drugSchedule',
  menuCourse: 'menuCourse',
  foodType: 'foodType',
  spiceLevel: 'spiceLevel',
  prepMinutes: 'prepMinutes',
  menuTags: 'menuTags',
  menuAvailable: 'menuAvailable',
  menuSortOrder: 'menuSortOrder',
  attributesJson: 'attributesJson',
  clientProductId: 'clientProductId',
  idempotencyKey: 'idempotencyKey',
  sourceDeviceId: 'sourceDeviceId',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CustomerScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  mobile: 'mobile',
  address: 'address',
  gstNumber: 'gstNumber',
  stateCode: 'stateCode',
  type: 'type',
  customerGroup: 'customerGroup',
  udharAmount: 'udharAmount',
  udharAmountPaise: 'udharAmountPaise',
  reminderOverrideUntil: 'reminderOverrideUntil',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BillScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  billNo: 'billNo',
  billType: 'billType',
  status: 'status',
  customerId: 'customerId',
  customerName: 'customerName',
  buyerGstin: 'buyerGstin',
  buyerStateCode: 'buyerStateCode',
  buyerAddress: 'buyerAddress',
  sellerGstin: 'sellerGstin',
  sellerStateCode: 'sellerStateCode',
  sellerLegalName: 'sellerLegalName',
  sellerTradeName: 'sellerTradeName',
  sellerAddress: 'sellerAddress',
  sellerCity: 'sellerCity',
  subtotal: 'subtotal',
  subtotalPaise: 'subtotalPaise',
  discount: 'discount',
  discountPaise: 'discountPaise',
  discountReason: 'discountReason',
  offerId: 'offerId',
  offerCode: 'offerCode',
  offerDiscount: 'offerDiscount',
  offerDiscountPaise: 'offerDiscountPaise',
  loyaltyPointsRedeemed: 'loyaltyPointsRedeemed',
  loyaltyDiscount: 'loyaltyDiscount',
  loyaltyDiscountPaise: 'loyaltyDiscountPaise',
  giftCardAmount: 'giftCardAmount',
  giftCardAmountPaise: 'giftCardAmountPaise',
  gst: 'gst',
  gstPaise: 'gstPaise',
  gstMode: 'gstMode',
  grandTotal: 'grandTotal',
  grandTotalPaise: 'grandTotalPaise',
  actualAmount: 'actualAmount',
  actualAmountPaise: 'actualAmountPaise',
  buyerPaidAmount: 'buyerPaidAmount',
  buyerPaidAmountPaise: 'buyerPaidAmountPaise',
  waivedAmount: 'waivedAmount',
  waivedAmountPaise: 'waivedAmountPaise',
  grossProfit: 'grossProfit',
  grossProfitPaise: 'grossProfitPaise',
  paidAmount: 'paidAmount',
  paidAmountPaise: 'paidAmountPaise',
  creditAmount: 'creditAmount',
  creditAmountPaise: 'creditAmountPaise',
  createdByUserId: 'createdByUserId',
  deviceId: 'deviceId',
  clientBillId: 'clientBillId',
  idempotencyKey: 'idempotencyKey',
  sourceDeviceId: 'sourceDeviceId',
  cancelledAt: 'cancelledAt',
  cancelledReason: 'cancelledReason',
  deletedAt: 'deletedAt',
  deletedReason: 'deletedReason',
  returnOfBillId: 'returnOfBillId',
  refundMode: 'refundMode',
  whatsappDeliveryState: 'whatsappDeliveryState',
  whatsappDeliveryAt: 'whatsappDeliveryAt',
  whatsappProviderMessageId: 'whatsappProviderMessageId',
  whatsappDeliveryKey: 'whatsappDeliveryKey',
  businessDate: 'businessDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BillItemScalarFieldEnum = {
  id: 'id',
  billId: 'billId',
  productId: 'productId',
  sellingUnitId: 'sellingUnitId',
  sellingUnitCode: 'sellingUnitCode',
  sellingUnitLabel: 'sellingUnitLabel',
  conversionToBase: 'conversionToBase',
  name: 'name',
  quantity: 'quantity',
  enteredUnit: 'enteredUnit',
  baseUnit: 'baseUnit',
  quantityInBaseUnit: 'quantityInBaseUnit',
  rateUnit: 'rateUnit',
  ratePerRateUnit: 'ratePerRateUnit',
  ratePerRateUnitPaise: 'ratePerRateUnitPaise',
  costPerRateUnit: 'costPerRateUnit',
  costPerRateUnitPaise: 'costPerRateUnitPaise',
  gstRate: 'gstRate',
  hsn: 'hsn',
  originalBillItemId: 'originalBillItemId',
  note: 'note',
  lineDiscount: 'lineDiscount',
  lineDiscountPaise: 'lineDiscountPaise',
  lineTotal: 'lineTotal',
  lineTotalPaise: 'lineTotalPaise',
  lineCost: 'lineCost',
  lineCostPaise: 'lineCostPaise',
  lineProfit: 'lineProfit',
  lineProfitPaise: 'lineProfitPaise',
  originalUnitPrice: 'originalUnitPrice',
  originalUnitPricePaise: 'originalUnitPricePaise',
  appliedPricingRuleId: 'appliedPricingRuleId',
  appliedPricingRuleType: 'appliedPricingRuleType',
  pricingExplanation: 'pricingExplanation',
  pricingConfidence: 'pricingConfidence',
  pricingCalculationVersion: 'pricingCalculationVersion',
  wasPriceOverridden: 'wasPriceOverridden',
  priceOverrideReason: 'priceOverrideReason',
  priceApprovedByUserId: 'priceApprovedByUserId'
};

exports.Prisma.PaymentScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  billId: 'billId',
  mode: 'mode',
  amount: 'amount',
  amountPaise: 'amountPaise',
  clientPaymentId: 'clientPaymentId',
  idempotencyKey: 'idempotencyKey',
  sourceDeviceId: 'sourceDeviceId',
  status: 'status',
  provider: 'provider',
  providerReference: 'providerReference',
  confirmationSource: 'confirmationSource',
  confirmedAt: 'confirmedAt',
  retailPaymentIntentId: 'retailPaymentIntentId',
  createdAt: 'createdAt'
};

exports.Prisma.RetailPaymentIntentScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  provider: 'provider',
  checkoutMode: 'checkoutMode',
  providerOrderId: 'providerOrderId',
  providerQrCodeId: 'providerQrCodeId',
  providerQrImageUrl: 'providerQrImageUrl',
  providerPaymentId: 'providerPaymentId',
  amountPaise: 'amountPaise',
  currency: 'currency',
  status: 'status',
  createdByUserId: 'createdByUserId',
  expiresAt: 'expiresAt',
  confirmedAt: 'confirmedAt',
  confirmationSource: 'confirmationSource',
  consumedAt: 'consumedAt',
  failureReason: 'failureReason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentProviderConnectionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  provider: 'provider',
  environment: 'environment',
  encryptedCredentials: 'encryptedCredentials',
  keyIdHint: 'keyIdHint',
  webhookSecretConfigured: 'webhookSecretConfigured',
  selected: 'selected',
  status: 'status',
  verifiedAt: 'verifiedAt',
  lastVerifiedAt: 'lastVerifiedAt',
  createdByUserId: 'createdByUserId',
  updatedByUserId: 'updatedByUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StoreLocationScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  code: 'code',
  name: 'name',
  address: 'address',
  city: 'city',
  gstNumber: 'gstNumber',
  gstStateCode: 'gstStateCode',
  gstLegalName: 'gstLegalName',
  gstTradeName: 'gstTradeName',
  gstRegistrationType: 'gstRegistrationType',
  phone: 'phone',
  isPrimary: 'isPrimary',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LocationStockScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  productId: 'productId',
  sellingUnitId: 'sellingUnitId',
  stockBaseQty: 'stockBaseQty',
  lowStockThreshold: 'lowStockThreshold',
  updatedAt: 'updatedAt'
};

exports.Prisma.StorageBinScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  code: 'code',
  name: 'name',
  zone: 'zone',
  kind: 'kind',
  sortOrder: 'sortOrder',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BinPlacementScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  binId: 'binId',
  productId: 'productId',
  sellingUnitId: 'sellingUnitId',
  stockBaseQty: 'stockBaseQty',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StockCountSessionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  activeKey: 'activeKey',
  name: 'name',
  status: 'status',
  blindCount: 'blindCount',
  createdByUserId: 'createdByUserId',
  approvedByUserId: 'approvedByUserId',
  submittedAt: 'submittedAt',
  appliedAt: 'appliedAt',
  cancelledAt: 'cancelledAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StockCountLineScalarFieldEnum = {
  id: 'id',
  sessionId: 'sessionId',
  productId: 'productId',
  productName: 'productName',
  baseUnit: 'baseUnit',
  expectedBaseQty: 'expectedBaseQty',
  countedBaseQty: 'countedBaseQty',
  varianceBaseQty: 'varianceBaseQty',
  reason: 'reason',
  countedByUserId: 'countedByUserId',
  countedAt: 'countedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GiftCardScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  customerId: 'customerId',
  codeHash: 'codeHash',
  codeLast4: 'codeLast4',
  status: 'status',
  initialBalancePaise: 'initialBalancePaise',
  balancePaise: 'balancePaise',
  expiresAt: 'expiresAt',
  issuedAt: 'issuedAt',
  disabledAt: 'disabledAt',
  note: 'note',
  createdByUserId: 'createdByUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GiftCardTransactionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  giftCardId: 'giftCardId',
  billId: 'billId',
  locationId: 'locationId',
  type: 'type',
  amountPaise: 'amountPaise',
  balanceAfterPaise: 'balanceAfterPaise',
  note: 'note',
  createdByUserId: 'createdByUserId',
  createdAt: 'createdAt'
};

exports.Prisma.StockTransferScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  referenceNo: 'referenceNo',
  fromLocationId: 'fromLocationId',
  toLocationId: 'toLocationId',
  status: 'status',
  fulfillmentMode: 'fulfillmentMode',
  movementReason: 'movementReason',
  documentType: 'documentType',
  documentNumber: 'documentNumber',
  documentDate: 'documentDate',
  gstTreatment: 'gstTreatment',
  fromGstin: 'fromGstin',
  fromStateCode: 'fromStateCode',
  toGstin: 'toGstin',
  toStateCode: 'toStateCode',
  isInterstate: 'isInterstate',
  complianceStatus: 'complianceStatus',
  eWayReviewRequired: 'eWayReviewRequired',
  eWayReviewStatus: 'eWayReviewStatus',
  eWayBillNumber: 'eWayBillNumber',
  eWayBillDate: 'eWayBillDate',
  eWayReviewReason: 'eWayReviewReason',
  eWayReviewedAt: 'eWayReviewedAt',
  eWayReviewedByUserId: 'eWayReviewedByUserId',
  taxableValue: 'taxableValue',
  taxableValuePaise: 'taxableValuePaise',
  cgst: 'cgst',
  cgstPaise: 'cgstPaise',
  sgst: 'sgst',
  sgstPaise: 'sgstPaise',
  igst: 'igst',
  igstPaise: 'igstPaise',
  taxTotal: 'taxTotal',
  taxTotalPaise: 'taxTotalPaise',
  consignmentValue: 'consignmentValue',
  consignmentValuePaise: 'consignmentValuePaise',
  note: 'note',
  createdByUserId: 'createdByUserId',
  approvedByUserId: 'approvedByUserId',
  approvedAt: 'approvedAt',
  dispatchedAt: 'dispatchedAt',
  expectedArrivalDate: 'expectedArrivalDate',
  carrierName: 'carrierName',
  trackingNumber: 'trackingNumber',
  receivedByUserId: 'receivedByUserId',
  lastReceivedAt: 'lastReceivedAt',
  cancelledAt: 'cancelledAt',
  cancelledByUserId: 'cancelledByUserId',
  cancelReason: 'cancelReason',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StockTransferItemScalarFieldEnum = {
  id: 'id',
  transferId: 'transferId',
  productId: 'productId',
  productName: 'productName',
  sellingUnitId: 'sellingUnitId',
  sellingUnitQty: 'sellingUnitQty',
  quantityBaseQty: 'quantityBaseQty',
  receivedBaseQty: 'receivedBaseQty',
  baseUnit: 'baseUnit',
  hsn: 'hsn',
  gstRate: 'gstRate',
  taxableValue: 'taxableValue',
  taxableValuePaise: 'taxableValuePaise',
  cgst: 'cgst',
  cgstPaise: 'cgstPaise',
  sgst: 'sgst',
  sgstPaise: 'sgstPaise',
  igst: 'igst',
  igstPaise: 'igstPaise',
  taxTotal: 'taxTotal',
  taxTotalPaise: 'taxTotalPaise',
  totalValue: 'totalValue',
  totalValuePaise: 'totalValuePaise'
};

exports.Prisma.StockTransferLotAllocationScalarFieldEnum = {
  id: 'id',
  transferItemId: 'transferItemId',
  sourceInventoryLotId: 'sourceInventoryLotId',
  sellingUnitId: 'sellingUnitId',
  batchNumber: 'batchNumber',
  manufacturedOn: 'manufacturedOn',
  expiresOn: 'expiresOn',
  quantityBaseQty: 'quantityBaseQty',
  receivedBaseQty: 'receivedBaseQty',
  costPerRateUnit: 'costPerRateUnit',
  costPerRateUnitPaise: 'costPerRateUnitPaise',
  mrp: 'mrp',
  mrpPaise: 'mrpPaise',
  sourceStatus: 'sourceStatus',
  sourceNote: 'sourceNote',
  createdAt: 'createdAt'
};

exports.Prisma.TransferDocumentCounterScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  fiscalYear: 'fiscalYear',
  documentType: 'documentType',
  lastNumber: 'lastNumber',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LoyaltyProgramScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  active: 'active',
  pointsPerRupee: 'pointsPerRupee',
  redemptionPaisePerPoint: 'redemptionPaisePerPoint',
  minimumRedeemPoints: 'minimumRedeemPoints',
  pointsExpireDays: 'pointsExpireDays',
  tierRulesJson: 'tierRulesJson',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LoyaltyAccountScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  customerId: 'customerId',
  pointsBalance: 'pointsBalance',
  lifetimeEarned: 'lifetimeEarned',
  lifetimeRedeemed: 'lifetimeRedeemed',
  lastEarnedAt: 'lastEarnedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LoyaltyTransactionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  accountId: 'accountId',
  billId: 'billId',
  locationId: 'locationId',
  type: 'type',
  lifecycleCycle: 'lifecycleCycle',
  points: 'points',
  source: 'source',
  note: 'note',
  createdAt: 'createdAt'
};

exports.Prisma.ComplianceDocumentScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  billId: 'billId',
  documentType: 'documentType',
  provider: 'provider',
  status: 'status',
  externalReference: 'externalReference',
  acknowledgementNo: 'acknowledgementNo',
  payloadHash: 'payloadHash',
  payloadJson: 'payloadJson',
  responseJson: 'responseJson',
  errorMessage: 'errorMessage',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StockLedgerScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  productId: 'productId',
  productName: 'productName',
  sellingUnitId: 'sellingUnitId',
  sellingUnitQty: 'sellingUnitQty',
  action: 'action',
  changeBaseQty: 'changeBaseQty',
  oldStockBaseQty: 'oldStockBaseQty',
  newStockBaseQty: 'newStockBaseQty',
  purchaseBillAmount: 'purchaseBillAmount',
  purchaseBillAmountPaise: 'purchaseBillAmountPaise',
  calculatedBuyRate: 'calculatedBuyRate',
  calculatedBuyRatePaise: 'calculatedBuyRatePaise',
  invoiceNumber: 'invoiceNumber',
  purchasePaymentStatus: 'purchasePaymentStatus',
  purchasePaymentMode: 'purchasePaymentMode',
  purchasePaidAmount: 'purchasePaidAmount',
  purchasePaidAmountPaise: 'purchasePaidAmountPaise',
  purchaseDueAmount: 'purchaseDueAmount',
  purchaseDueAmountPaise: 'purchaseDueAmountPaise',
  purchaseDueDate: 'purchaseDueDate',
  supplierName: 'supplierName',
  damageLossValue: 'damageLossValue',
  damageLossValuePaise: 'damageLossValuePaise',
  billId: 'billId',
  clientMovementId: 'clientMovementId',
  idempotencyKey: 'idempotencyKey',
  sourceDeviceId: 'sourceDeviceId',
  sourceType: 'sourceType',
  sourceId: 'sourceId',
  actorUserId: 'actorUserId',
  actorName: 'actorName',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UdharLedgerScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  customerId: 'customerId',
  customerName: 'customerName',
  type: 'type',
  amount: 'amount',
  amountPaise: 'amountPaise',
  mode: 'mode',
  billId: 'billId',
  billNo: 'billNo',
  clientLedgerId: 'clientLedgerId',
  idempotencyKey: 'idempotencyKey',
  sourceDeviceId: 'sourceDeviceId',
  sourceType: 'sourceType',
  sourceId: 'sourceId',
  note: 'note',
  reversedAt: 'reversedAt',
  reversedReason: 'reversedReason',
  reversalOfLedgerId: 'reversalOfLedgerId',
  reversedByUserId: 'reversedByUserId',
  businessDate: 'businessDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TallyPostScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  documentType: 'documentType',
  documentId: 'documentId',
  voucherNumber: 'voucherNumber',
  remoteId: 'remoteId',
  postedAt: 'postedAt'
};

exports.Prisma.SupplierScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  gstin: 'gstin',
  mobile: 'mobile',
  address: 'address',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ExpenseScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  title: 'title',
  amount: 'amount',
  amountPaise: 'amountPaise',
  idempotencyKey: 'idempotencyKey',
  clientExpenseId: 'clientExpenseId',
  sourceDeviceId: 'sourceDeviceId',
  category: 'category',
  paymentMode: 'paymentMode',
  vendor: 'vendor',
  status: 'status',
  recurringInterval: 'recurringInterval',
  nextDueOn: 'nextDueOn',
  recordedBy: 'recordedBy',
  recordedByUserId: 'recordedByUserId',
  recordedByRole: 'recordedByRole',
  notes: 'notes',
  spentAt: 'spentAt',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.OfferScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  title: 'title',
  code: 'code',
  type: 'type',
  value: 'value',
  minBillAmount: 'minBillAmount',
  maxDiscount: 'maxDiscount',
  scope: 'scope',
  scopeValue: 'scopeValue',
  validFrom: 'validFrom',
  validTo: 'validTo',
  usageLimit: 'usageLimit',
  usedCount: 'usedCount',
  discountGiven: 'discountGiven',
  active: 'active',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PurchaseHistoryScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  productId: 'productId',
  supplierId: 'supplierId',
  purchaseOrderId: 'purchaseOrderId',
  purchaseOrderItemId: 'purchaseOrderItemId',
  purchaseReceiptId: 'purchaseReceiptId',
  supplierName: 'supplierName',
  qtyBase: 'qtyBase',
  pricePerRateUnit: 'pricePerRateUnit',
  pricePerRateUnitPaise: 'pricePerRateUnitPaise',
  totalCost: 'totalCost',
  totalCostPaise: 'totalCostPaise',
  billAmount: 'billAmount',
  billAmountPaise: 'billAmountPaise',
  invoiceNumber: 'invoiceNumber',
  purchasePaymentStatus: 'purchasePaymentStatus',
  purchasePaymentMode: 'purchasePaymentMode',
  purchasePaidAmount: 'purchasePaidAmount',
  purchasePaidAmountPaise: 'purchasePaidAmountPaise',
  purchaseDueAmount: 'purchaseDueAmount',
  purchaseDueAmountPaise: 'purchaseDueAmountPaise',
  purchaseDueDate: 'purchaseDueDate',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PurchaseOrderScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  supplierId: 'supplierId',
  orderNumber: 'orderNumber',
  supplierName: 'supplierName',
  status: 'status',
  expectedOn: 'expectedOn',
  expectedTotal: 'expectedTotal',
  expectedTotalPaise: 'expectedTotalPaise',
  vendorReference: 'vendorReference',
  paymentTerms: 'paymentTerms',
  deliveryAddress: 'deliveryAddress',
  termsAndConditions: 'termsAndConditions',
  note: 'note',
  createdByUserId: 'createdByUserId',
  sentAt: 'sentAt',
  receivedAt: 'receivedAt',
  cancelledAt: 'cancelledAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PurchaseOrderItemScalarFieldEnum = {
  id: 'id',
  purchaseOrderId: 'purchaseOrderId',
  productId: 'productId',
  productName: 'productName',
  baseUnit: 'baseUnit',
  rateUnit: 'rateUnit',
  orderedBaseQty: 'orderedBaseQty',
  receivedBaseQty: 'receivedBaseQty',
  expectedRate: 'expectedRate',
  expectedRatePaise: 'expectedRatePaise',
  expectedAmount: 'expectedAmount',
  expectedAmountPaise: 'expectedAmountPaise'
};

exports.Prisma.PurchaseReceiptScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  purchaseOrderId: 'purchaseOrderId',
  supplierId: 'supplierId',
  receiptNumber: 'receiptNumber',
  supplierInvoiceNumber: 'supplierInvoiceNumber',
  supplierInvoiceAmount: 'supplierInvoiceAmount',
  supplierInvoiceAmountPaise: 'supplierInvoiceAmountPaise',
  supplierInvoiceTax: 'supplierInvoiceTax',
  supplierInvoiceTaxPaise: 'supplierInvoiceTaxPaise',
  expectedGoodsAmount: 'expectedGoodsAmount',
  expectedGoodsAmountPaise: 'expectedGoodsAmountPaise',
  priceVarianceAmount: 'priceVarianceAmount',
  priceVarianceAmountPaise: 'priceVarianceAmountPaise',
  invoiceVarianceAmount: 'invoiceVarianceAmount',
  invoiceVarianceAmountPaise: 'invoiceVarianceAmountPaise',
  matchStatus: 'matchStatus',
  varianceReason: 'varianceReason',
  varianceApprovedByUserId: 'varianceApprovedByUserId',
  varianceApprovedAt: 'varianceApprovedAt',
  idempotencyKey: 'idempotencyKey',
  totalAmount: 'totalAmount',
  totalAmountPaise: 'totalAmountPaise',
  paidAmount: 'paidAmount',
  paidAmountPaise: 'paidAmountPaise',
  dueAmount: 'dueAmount',
  dueAmountPaise: 'dueAmountPaise',
  paymentMode: 'paymentMode',
  dueDate: 'dueDate',
  note: 'note',
  receivedByUserId: 'receivedByUserId',
  createdAt: 'createdAt'
};

exports.Prisma.PurchaseReceiptItemScalarFieldEnum = {
  id: 'id',
  receiptId: 'receiptId',
  purchaseOrderItemId: 'purchaseOrderItemId',
  productId: 'productId',
  quantityBaseQty: 'quantityBaseQty',
  actualRate: 'actualRate',
  actualRatePaise: 'actualRatePaise',
  lineAmount: 'lineAmount',
  lineAmountPaise: 'lineAmountPaise',
  stockLedgerId: 'stockLedgerId',
  purchaseHistoryId: 'purchaseHistoryId'
};

exports.Prisma.PurchaseReturnScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  supplierId: 'supplierId',
  purchaseReceiptId: 'purchaseReceiptId',
  returnNumber: 'returnNumber',
  refundMode: 'refundMode',
  totalAmount: 'totalAmount',
  totalAmountPaise: 'totalAmountPaise',
  taxAmount: 'taxAmount',
  taxAmountPaise: 'taxAmountPaise',
  supplierCreditAmount: 'supplierCreditAmount',
  supplierCreditAmountPaise: 'supplierCreditAmountPaise',
  refundAmount: 'refundAmount',
  refundAmountPaise: 'refundAmountPaise',
  reason: 'reason',
  supplierReference: 'supplierReference',
  idempotencyKey: 'idempotencyKey',
  status: 'status',
  cancelledAt: 'cancelledAt',
  cancelledByUserId: 'cancelledByUserId',
  cancellationReason: 'cancellationReason',
  createdByUserId: 'createdByUserId',
  createdAt: 'createdAt'
};

exports.Prisma.PurchaseReturnItemScalarFieldEnum = {
  id: 'id',
  purchaseReturnId: 'purchaseReturnId',
  purchaseReceiptItemId: 'purchaseReceiptItemId',
  productId: 'productId',
  quantityBaseQty: 'quantityBaseQty',
  actualRate: 'actualRate',
  actualRatePaise: 'actualRatePaise',
  lineAmount: 'lineAmount',
  lineAmountPaise: 'lineAmountPaise',
  lotAllocationsJson: 'lotAllocationsJson'
};

exports.Prisma.InventoryLotScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  productId: 'productId',
  purchaseReceiptItemId: 'purchaseReceiptItemId',
  sellingUnitId: 'sellingUnitId',
  producedByRunId: 'producedByRunId',
  batchNumber: 'batchNumber',
  manufacturedOn: 'manufacturedOn',
  expiresOn: 'expiresOn',
  receivedBaseQty: 'receivedBaseQty',
  availableBaseQty: 'availableBaseQty',
  costPerRateUnit: 'costPerRateUnit',
  costPerRateUnitPaise: 'costPerRateUnitPaise',
  mrp: 'mrp',
  mrpPaise: 'mrpPaise',
  status: 'status',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ManufacturingBomScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  finishedProductId: 'finishedProductId',
  name: 'name',
  version: 'version',
  status: 'status',
  outputQuantityBaseQty: 'outputQuantityBaseQty',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ManufacturingBomItemScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  bomId: 'bomId',
  materialProductId: 'materialProductId',
  quantityBaseQty: 'quantityBaseQty',
  wastagePercent: 'wastagePercent',
  createdAt: 'createdAt'
};

exports.Prisma.ProductionRunScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  bomId: 'bomId',
  runNumber: 'runNumber',
  status: 'status',
  plannedOutputBaseQty: 'plannedOutputBaseQty',
  actualOutputBaseQty: 'actualOutputBaseQty',
  finishedBatchNumber: 'finishedBatchNumber',
  manufacturedOn: 'manufacturedOn',
  expiresOn: 'expiresOn',
  qcStatus: 'qcStatus',
  notes: 'notes',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProductionConsumptionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  runId: 'runId',
  productId: 'productId',
  inventoryLotId: 'inventoryLotId',
  plannedBaseQty: 'plannedBaseQty',
  actualBaseQty: 'actualBaseQty',
  sourceBatchNumber: 'sourceBatchNumber',
  createdAt: 'createdAt'
};

exports.Prisma.ProductionOutputScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  runId: 'runId',
  productId: 'productId',
  sellingUnitId: 'sellingUnitId',
  inventoryLotId: 'inventoryLotId',
  packagingSku: 'packagingSku',
  quantityBaseQty: 'quantityBaseQty',
  packageCount: 'packageCount',
  batchNumber: 'batchNumber',
  createdAt: 'createdAt'
};

exports.Prisma.TradeOrderScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  orderNumber: 'orderNumber',
  buyerPoNumber: 'buyerPoNumber',
  customerId: 'customerId',
  customerName: 'customerName',
  customerGstin: 'customerGstin',
  billingAddress: 'billingAddress',
  shippingAddress: 'shippingAddress',
  orderType: 'orderType',
  status: 'status',
  currencyCode: 'currencyCode',
  exchangeRate: 'exchangeRate',
  priceBasis: 'priceBasis',
  requestedDeliveryDate: 'requestedDeliveryDate',
  iec: 'iec',
  lutBondReference: 'lutBondReference',
  countryOfDestination: 'countryOfDestination',
  countryOfOrigin: 'countryOfOrigin',
  portOfLoading: 'portOfLoading',
  portOfDischarge: 'portOfDischarge',
  incoterm: 'incoterm',
  paymentTerms: 'paymentTerms',
  notes: 'notes',
  billId: 'billId',
  confirmedAt: 'confirmedAt',
  allocatedAt: 'allocatedAt',
  packedAt: 'packedAt',
  dispatchedAt: 'dispatchedAt',
  cancelledAt: 'cancelledAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TradeOrderItemScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  orderId: 'orderId',
  productId: 'productId',
  sellingUnitId: 'sellingUnitId',
  sku: 'sku',
  buyerProductCode: 'buyerProductCode',
  description: 'description',
  hsn: 'hsn',
  quantity: 'quantity',
  quantityBaseQty: 'quantityBaseQty',
  unitPrice: 'unitPrice',
  gstRate: 'gstRate',
  lineDiscount: 'lineDiscount',
  lineTotal: 'lineTotal',
  packedQuantity: 'packedQuantity',
  createdAt: 'createdAt'
};

exports.Prisma.TradeOrderAllocationScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  orderItemId: 'orderItemId',
  inventoryLotId: 'inventoryLotId',
  batchNumber: 'batchNumber',
  quantityBaseQty: 'quantityBaseQty',
  createdAt: 'createdAt'
};

exports.Prisma.TradeDispatchScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  orderId: 'orderId',
  dispatchNumber: 'dispatchNumber',
  dispatchDate: 'dispatchDate',
  transporterName: 'transporterName',
  transporterGstin: 'transporterGstin',
  vehicleNumber: 'vehicleNumber',
  lrAwbNumber: 'lrAwbNumber',
  ewayBillNumber: 'ewayBillNumber',
  shippingBillNumber: 'shippingBillNumber',
  shippingBillDate: 'shippingBillDate',
  containerNumber: 'containerNumber',
  packageCount: 'packageCount',
  netWeight: 'netWeight',
  grossWeight: 'grossWeight',
  sealNumber: 'sealNumber',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BillItemLotAllocationScalarFieldEnum = {
  id: 'id',
  billItemId: 'billItemId',
  inventoryLotId: 'inventoryLotId',
  quantityBaseQty: 'quantityBaseQty',
  createdAt: 'createdAt'
};

exports.Prisma.UserLocationAccessScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  locationId: 'locationId',
  canSell: 'canSell',
  canPurchase: 'canPurchase',
  canManageInventory: 'canManageInventory',
  canTransfer: 'canTransfer',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AiActionLogScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  transcript: 'transcript',
  parsedActionJson: 'parsedActionJson',
  permissionLevel: 'permissionLevel',
  status: 'status',
  error: 'error',
  createdAt: 'createdAt'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  deviceId: 'deviceId',
  module: 'module',
  action: 'action',
  entityType: 'entityType',
  entityId: 'entityId',
  beforeJson: 'beforeJson',
  afterJson: 'afterJson',
  metadataJson: 'metadataJson',
  result: 'result',
  durationMs: 'durationMs',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  createdAt: 'createdAt'
};

exports.Prisma.DailyClosingSnapshotScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  storeId: 'storeId',
  date: 'date',
  totalSalesPaise: 'totalSalesPaise',
  cashReceivedPaise: 'cashReceivedPaise',
  upiReceivedPaise: 'upiReceivedPaise',
  bankReceivedPaise: 'bankReceivedPaise',
  udharGivenPaise: 'udharGivenPaise',
  oldUdharRecoveredPaise: 'oldUdharRecoveredPaise',
  expectedCashPaise: 'expectedCashPaise',
  openingCashPaise: 'openingCashPaise',
  manualCashInPaise: 'manualCashInPaise',
  manualCashOutPaise: 'manualCashOutPaise',
  drawerExpectedCashPaise: 'drawerExpectedCashPaise',
  countedCashPaise: 'countedCashPaise',
  cashVariancePaise: 'cashVariancePaise',
  cashCountedAt: 'cashCountedAt',
  cashCountedByUserId: 'cashCountedByUserId',
  cashCountedByDeviceId: 'cashCountedByDeviceId',
  cashCountRevision: 'cashCountRevision',
  totalBills: 'totalBills',
  cancelledBills: 'cancelledBills',
  roughBills: 'roughBills',
  pendingSyncCount: 'pendingSyncCount',
  topProductsJson: 'topProductsJson',
  lowStockJson: 'lowStockJson',
  generatedByUserId: 'generatedByUserId',
  generatedAt: 'generatedAt',
  lockedAt: 'lockedAt',
  lockedByUserId: 'lockedByUserId',
  source: 'source',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReportExportJobScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  requestedByUserId: 'requestedByUserId',
  reportType: 'reportType',
  status: 'status',
  paramsJson: 'paramsJson',
  fileName: 'fileName',
  filePath: 'filePath',
  fileUrl: 'fileUrl',
  mimeType: 'mimeType',
  sizeBytes: 'sizeBytes',
  error: 'error',
  requestedAt: 'requestedAt',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BackupArtifactScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  requestedByUserId: 'requestedByUserId',
  type: 'type',
  status: 'status',
  format: 'format',
  storageProvider: 'storageProvider',
  objectKey: 'objectKey',
  checksumSha256: 'checksumSha256',
  sizeBytes: 'sizeBytes',
  recordCount: 'recordCount',
  schemaVersion: 'schemaVersion',
  errorCode: 'errorCode',
  errorMessage: 'errorMessage',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReminderTemplateScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  channel: 'channel',
  templateText: 'templateText',
  active: 'active',
  createdByUserId: 'createdByUserId',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReminderLogScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  customerId: 'customerId',
  channel: 'channel',
  templateId: 'templateId',
  message: 'message',
  status: 'status',
  provider: 'provider',
  providerMessageId: 'providerMessageId',
  error: 'error',
  acceptedAt: 'acceptedAt',
  sentAt: 'sentAt',
  deliveredAt: 'deliveredAt',
  readAt: 'readAt',
  failedAt: 'failedAt',
  lastStatusAt: 'lastStatusAt',
  requestedByUserId: 'requestedByUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReminderDeliveryEventScalarFieldEnum = {
  id: 'id',
  provider: 'provider',
  providerMessageId: 'providerMessageId',
  status: 'status',
  errorCode: 'errorCode',
  eventAt: 'eventAt',
  reminderLogId: 'reminderLogId',
  processedAt: 'processedAt',
  receivedAt: 'receivedAt'
};

exports.Prisma.OfflineSyncEventScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  eventId: 'eventId',
  type: 'type',
  status: 'status',
  attempts: 'attempts',
  requestJson: 'requestJson',
  resultJson: 'resultJson',
  error: 'error',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SyncConflictScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  sourceEventId: 'sourceEventId',
  clientConflictId: 'clientConflictId',
  deviceId: 'deviceId',
  reportedByUserId: 'reportedByUserId',
  entityType: 'entityType',
  entityId: 'entityId',
  reasonCode: 'reasonCode',
  message: 'message',
  status: 'status',
  localSnapshotJson: 'localSnapshotJson',
  serverSnapshotJson: 'serverSnapshotJson',
  baseSnapshotJson: 'baseSnapshotJson',
  serverVersion: 'serverVersion',
  resolution: 'resolution',
  mergedPayloadJson: 'mergedPayloadJson',
  resolutionNote: 'resolutionNote',
  resolvedByUserId: 'resolvedByUserId',
  resolvedByDeviceId: 'resolvedByDeviceId',
  version: 'version',
  detectedAt: 'detectedAt',
  resolvedAt: 'resolvedAt',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SyncCommandScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  deviceId: 'deviceId',
  clientCommandId: 'clientCommandId',
  idempotencyKey: 'idempotencyKey',
  type: 'type',
  requestHash: 'requestHash',
  status: 'status',
  resultJson: 'resultJson',
  error: 'error',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ChangeLogScalarFieldEnum = {
  seq: 'seq',
  shopId: 'shopId',
  entityType: 'entityType',
  entityId: 'entityId',
  operation: 'operation',
  payloadJson: 'payloadJson',
  createdAt: 'createdAt'
};

exports.Prisma.FinancialLedgerScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  customerId: 'customerId',
  supplierId: 'supplierId',
  billId: 'billId',
  paymentId: 'paymentId',
  purchaseBillId: 'purchaseBillId',
  sourceType: 'sourceType',
  sourceId: 'sourceId',
  entryType: 'entryType',
  direction: 'direction',
  amountPaise: 'amountPaise',
  paymentMode: 'paymentMode',
  businessDate: 'businessDate',
  serverSeq: 'serverSeq',
  idempotencyKey: 'idempotencyKey',
  evidenceJson: 'evidenceJson',
  reversedById: 'reversedById',
  createdAt: 'createdAt'
};

exports.Prisma.ChartOfAccountScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  code: 'code',
  name: 'name',
  category: 'category',
  normalSide: 'normalSide',
  systemKey: 'systemKey',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.JournalEntryScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  sourceType: 'sourceType',
  sourceId: 'sourceId',
  businessDate: 'businessDate',
  status: 'status',
  description: 'description',
  evidenceJson: 'evidenceJson',
  reversalOfId: 'reversalOfId',
  postedAt: 'postedAt',
  createdAt: 'createdAt'
};

exports.Prisma.JournalLineScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  journalEntryId: 'journalEntryId',
  accountId: 'accountId',
  financialLedgerId: 'financialLedgerId',
  lineNumber: 'lineNumber',
  debitPaise: 'debitPaise',
  creditPaise: 'creditPaise',
  memo: 'memo',
  evidenceJson: 'evidenceJson',
  createdAt: 'createdAt'
};

exports.Prisma.AccountingPeriodScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  startsAt: 'startsAt',
  endsAt: 'endsAt',
  status: 'status',
  closedAt: 'closedAt',
  closedByUserId: 'closedByUserId',
  closeReason: 'closeReason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AccountingDocumentScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  documentType: 'documentType',
  status: 'status',
  sourceHash: 'sourceHash',
  sourceMimeType: 'sourceMimeType',
  sourceBytes: 'sourceBytes',
  supplierId: 'supplierId',
  supplierMatch: 'supplierMatch',
  extractedJson: 'extractedJson',
  validationJson: 'validationJson',
  suggestedJournalJson: 'suggestedJournalJson',
  evidenceJson: 'evidenceJson',
  createdByUserId: 'createdByUserId',
  reviewedByUserId: 'reviewedByUserId',
  reviewedAt: 'reviewedAt',
  reviewReason: 'reviewReason',
  journalEntryId: 'journalEntryId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AccountingDocumentEventScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  documentId: 'documentId',
  action: 'action',
  actorUserId: 'actorUserId',
  payloadJson: 'payloadJson',
  createdAt: 'createdAt'
};

exports.Prisma.BankStatementImportScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  accountType: 'accountType',
  accountName: 'accountName',
  accountLast4: 'accountLast4',
  fileName: 'fileName',
  statementFrom: 'statementFrom',
  statementTo: 'statementTo',
  rowCount: 'rowCount',
  importedCount: 'importedCount',
  duplicateCount: 'duplicateCount',
  status: 'status',
  fingerprint: 'fingerprint',
  importedByUserId: 'importedByUserId',
  createdAt: 'createdAt'
};

exports.Prisma.BankStatementTransactionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  importId: 'importId',
  rowNumber: 'rowNumber',
  transactionDate: 'transactionDate',
  description: 'description',
  reference: 'reference',
  direction: 'direction',
  amountPaise: 'amountPaise',
  balancePaise: 'balancePaise',
  fingerprint: 'fingerprint',
  matchStatus: 'matchStatus',
  reconciledAmountPaise: 'reconciledAmountPaise',
  ignoredReason: 'ignoredReason',
  ignoredByUserId: 'ignoredByUserId',
  ignoredAt: 'ignoredAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BankReconciliationAllocationScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  bankStatementTransactionId: 'bankStatementTransactionId',
  ledgerRowId: 'ledgerRowId',
  amountPaise: 'amountPaise',
  activeLedgerKey: 'activeLedgerKey',
  activeBankLedgerKey: 'activeBankLedgerKey',
  method: 'method',
  evidenceJson: 'evidenceJson',
  status: 'status',
  matchedByUserId: 'matchedByUserId',
  matchedAt: 'matchedAt',
  reversedByUserId: 'reversedByUserId',
  reversedAt: 'reversedAt',
  reversalReason: 'reversalReason'
};

exports.Prisma.BankReconciliationEventScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  bankStatementTransactionId: 'bankStatementTransactionId',
  action: 'action',
  payloadJson: 'payloadJson',
  userId: 'userId',
  createdAt: 'createdAt'
};

exports.Prisma.SyncIdMappingScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  entityType: 'entityType',
  localId: 'localId',
  serverId: 'serverId',
  sourceEventId: 'sourceEventId',
  deviceId: 'deviceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ErrorGroupScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  fingerprint: 'fingerprint',
  source: 'source',
  title: 'title',
  errorCode: 'errorCode',
  sampleMessage: 'sampleMessage',
  sampleStack: 'sampleStack',
  count: 'count',
  status: 'status',
  firstSeenAt: 'firstSeenAt',
  lastSeenAt: 'lastSeenAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ErrorEventScalarFieldEnum = {
  id: 'id',
  groupId: 'groupId',
  shopId: 'shopId',
  userId: 'userId',
  deviceId: 'deviceId',
  orgId: 'orgId',
  source: 'source',
  message: 'message',
  stack: 'stack',
  errorCode: 'errorCode',
  endpoint: 'endpoint',
  functionName: 'functionName',
  fileName: 'fileName',
  lineNumber: 'lineNumber',
  appVersion: 'appVersion',
  backendVersion: 'backendVersion',
  os: 'os',
  browser: 'browser',
  networkStatus: 'networkStatus',
  onlineMode: 'onlineMode',
  memoryUsageMb: 'memoryUsageMb',
  route: 'route',
  createdAt: 'createdAt'
};

exports.Prisma.SupportRequestScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  deviceId: 'deviceId',
  description: 'description',
  page: 'page',
  appVersion: 'appVersion',
  status: 'status',
  contextJson: 'contextJson',
  screenshotKey: 'screenshotKey',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DeviceHealthSnapshotScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  deviceId: 'deviceId',
  userId: 'userId',
  overallStatus: 'overallStatus',
  healthScore: 'healthScore',
  printerStatus: 'printerStatus',
  printerName: 'printerName',
  scannerStatus: 'scannerStatus',
  online: 'online',
  networkType: 'networkType',
  dbStatus: 'dbStatus',
  storageUsedMb: 'storageUsedMb',
  storageQuotaMb: 'storageQuotaMb',
  appVersion: 'appVersion',
  os: 'os',
  browser: 'browser',
  batteryLevel: 'batteryLevel',
  batteryCharging: 'batteryCharging',
  ramUsedMb: 'ramUsedMb',
  ramLimitMb: 'ramLimitMb',
  cpuPercent: 'cpuPercent',
  extraJson: 'extraJson',
  createdAt: 'createdAt'
};

exports.Prisma.SupportSessionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  grantedByUserId: 'grantedByUserId',
  deviceId: 'deviceId',
  codeHash: 'codeHash',
  scope: 'scope',
  status: 'status',
  operatorEmail: 'operatorEmail',
  reason: 'reason',
  redeemedAt: 'redeemedAt',
  expiresAt: 'expiresAt',
  revokedAt: 'revokedAt',
  endedAt: 'endedAt',
  commandCount: 'commandCount',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DeviceCommandScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  sessionId: 'sessionId',
  playbookId: 'playbookId',
  deviceId: 'deviceId',
  type: 'type',
  paramsJson: 'paramsJson',
  status: 'status',
  issuedByEmail: 'issuedByEmail',
  issuedByUserId: 'issuedByUserId',
  reason: 'reason',
  attempts: 'attempts',
  deliveredAt: 'deliveredAt',
  completedAt: 'completedAt',
  resultJson: 'resultJson',
  error: 'error',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PlanScalarFieldEnum = {
  id: 'id',
  code: 'code',
  name: 'name',
  priceMonthlyPaise: 'priceMonthlyPaise',
  priceYearlyPaise: 'priceYearlyPaise',
  maxDevices: 'maxDevices',
  maxStores: 'maxStores',
  maxStaff: 'maxStaff',
  featuresJson: 'featuresJson',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SubscriptionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  planCode: 'planCode',
  status: 'status',
  provider: 'provider',
  providerSubscriptionId: 'providerSubscriptionId',
  currentPeriodStart: 'currentPeriodStart',
  currentPeriodEnd: 'currentPeriodEnd',
  trialEndsAt: 'trialEndsAt',
  graceEndsAt: 'graceEndsAt',
  cancelledAt: 'cancelledAt',
  lockedPriceMonthlyPaise: 'lockedPriceMonthlyPaise',
  lockedPriceYearlyPaise: 'lockedPriceYearlyPaise',
  entitledFeaturesJson: 'entitledFeaturesJson',
  intendedPaidPlanCode: 'intendedPaidPlanCode',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.OnboardingPurchaseScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  sku: 'sku',
  amountPaise: 'amountPaise',
  status: 'status',
  includesJson: 'includesJson',
  recordedByUserId: 'recordedByUserId',
  deliveredAt: 'deliveredAt',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentTransactionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  subscriptionId: 'subscriptionId',
  provider: 'provider',
  providerPaymentId: 'providerPaymentId',
  amountPaise: 'amountPaise',
  currency: 'currency',
  status: 'status',
  paidAt: 'paidAt',
  failureReason: 'failureReason',
  rawPayloadJson: 'rawPayloadJson',
  createdAt: 'createdAt'
};

exports.Prisma.PaymentProviderEventScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  provider: 'provider',
  eventId: 'eventId',
  eventType: 'eventType',
  payloadJson: 'payloadJson',
  signatureVerified: 'signatureVerified',
  processingStatus: 'processingStatus',
  processingAttempts: 'processingAttempts',
  processingError: 'processingError',
  processedResultJson: 'processedResultJson',
  lastAttemptAt: 'lastAttemptAt',
  processedAt: 'processedAt',
  createdAt: 'createdAt'
};

exports.Prisma.IntegrationApiKeyScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  keyPrefix: 'keyPrefix',
  keyHash: 'keyHash',
  scopesJson: 'scopesJson',
  createdByUserId: 'createdByUserId',
  lastUsedAt: 'lastUsedAt',
  expiresAt: 'expiresAt',
  revokedAt: 'revokedAt',
  createdAt: 'createdAt'
};

exports.Prisma.WebhookEndpointScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  url: 'url',
  eventsJson: 'eventsJson',
  enabled: 'enabled',
  deletedAt: 'deletedAt',
  createdByUserId: 'createdByUserId',
  lastSuccessAt: 'lastSuccessAt',
  lastFailureAt: 'lastFailureAt',
  lastError: 'lastError',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WebhookDeliveryScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  endpointId: 'endpointId',
  eventId: 'eventId',
  eventType: 'eventType',
  payloadJson: 'payloadJson',
  status: 'status',
  attemptCount: 'attemptCount',
  httpStatus: 'httpStatus',
  durationMs: 'durationMs',
  responseSnippet: 'responseSnippet',
  lastError: 'lastError',
  lastAttemptAt: 'lastAttemptAt',
  deliveredAt: 'deliveredAt',
  createdAt: 'createdAt'
};

exports.Prisma.DeviceScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  deviceId: 'deviceId',
  deviceName: 'deviceName',
  platform: 'platform',
  deviceType: 'deviceType',
  operatingSystem: 'operatingSystem',
  browser: 'browser',
  userAgent: 'userAgent',
  appVersion: 'appVersion',
  fingerprintHash: 'fingerprintHash',
  status: 'status',
  isTrusted: 'isTrusted',
  activatedAt: 'activatedAt',
  lastActiveAt: 'lastActiveAt',
  lastLoginAt: 'lastLoginAt',
  lastSeenAt: 'lastSeenAt',
  lastSyncAt: 'lastSyncAt',
  lastAppliedServerSeq: 'lastAppliedServerSeq',
  lastSyncAckAt: 'lastSyncAckAt',
  lastIpAddress: 'lastIpAddress',
  sessionVersion: 'sessionVersion',
  dataEpoch: 'dataEpoch',
  removedAt: 'removedAt',
  revokedAt: 'revokedAt',
  revokedByUserId: 'revokedByUserId',
  revokeReason: 'revokeReason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DeviceReplacementChallengeScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  newDeviceId: 'newDeviceId',
  deviceJson: 'deviceJson',
  expiresAt: 'expiresAt',
  consumedAt: 'consumedAt',
  createdAt: 'createdAt'
};

exports.Prisma.DeviceLicenseScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  deviceId: 'deviceId',
  planCode: 'planCode',
  featuresJson: 'featuresJson',
  validUntil: 'validUntil',
  offlineGraceUntil: 'offlineGraceUntil',
  signatureHash: 'signatureHash',
  issuedAt: 'issuedAt',
  revokedAt: 'revokedAt'
};

exports.Prisma.AuditRuleScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  ruleCode: 'ruleCode',
  enabled: 'enabled',
  weightOverride: 'weightOverride',
  thresholdsJson: 'thresholdsJson',
  updatedByUserId: 'updatedByUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditRunScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  runType: 'runType',
  status: 'status',
  engineVersion: 'engineVersion',
  rulesetVersion: 'rulesetVersion',
  scopeJson: 'scopeJson',
  periodFrom: 'periodFrom',
  periodTo: 'periodTo',
  entitiesEvaluated: 'entitiesEvaluated',
  findingsCreated: 'findingsCreated',
  findingsUpdated: 'findingsUpdated',
  summaryJson: 'summaryJson',
  error: 'error',
  triggeredByUserId: 'triggeredByUserId',
  startedAt: 'startedAt',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditEvaluationScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  auditRunId: 'auditRunId',
  sourceEntityType: 'sourceEntityType',
  sourceEntityId: 'sourceEntityId',
  inputHash: 'inputHash',
  engineVersion: 'engineVersion',
  rulesetVersion: 'rulesetVersion',
  triggeredRuleCodesJson: 'triggeredRuleCodesJson',
  riskScore: 'riskScore',
  resultJson: 'resultJson',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditFindingScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  dedupeKey: 'dedupeKey',
  sourceEntityType: 'sourceEntityType',
  sourceEntityId: 'sourceEntityId',
  sourceEventType: 'sourceEventType',
  firstAuditRunId: 'firstAuditRunId',
  lastAuditRunId: 'lastAuditRunId',
  lastEvaluationId: 'lastEvaluationId',
  title: 'title',
  status: 'status',
  primaryCategory: 'primaryCategory',
  riskScore: 'riskScore',
  riskLevel: 'riskLevel',
  confidence: 'confidence',
  amountPaise: 'amountPaise',
  discrepancyPaise: 'discrepancyPaise',
  scoreBreakdownJson: 'scoreBreakdownJson',
  aiExplanation: 'aiExplanation',
  aiExplanationLang: 'aiExplanationLang',
  assignedReviewerId: 'assignedReviewerId',
  occurredAt: 'occurredAt',
  resolvedAt: 'resolvedAt',
  resolutionType: 'resolutionType',
  reopenCount: 'reopenCount',
  engineVersion: 'engineVersion',
  rulesetVersion: 'rulesetVersion',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditFindingRuleScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  findingId: 'findingId',
  ruleCode: 'ruleCode',
  ruleVersion: 'ruleVersion',
  category: 'category',
  severity: 'severity',
  scoreContribution: 'scoreContribution',
  detailsJson: 'detailsJson',
  active: 'active',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditEvidenceRequirementScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  findingId: 'findingId',
  evidenceType: 'evidenceType',
  description: 'description',
  status: 'status',
  requestedByUserId: 'requestedByUserId',
  dueAt: 'dueAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditEvidenceScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  findingId: 'findingId',
  requirementId: 'requirementId',
  evidenceType: 'evidenceType',
  referenceKind: 'referenceKind',
  referenceValue: 'referenceValue',
  originalFilename: 'originalFilename',
  mimeType: 'mimeType',
  sizeBytes: 'sizeBytes',
  checksumSha256: 'checksumSha256',
  storageKey: 'storageKey',
  uploadedByUserId: 'uploadedByUserId',
  verificationStatus: 'verificationStatus',
  verifiedByUserId: 'verifiedByUserId',
  verifiedAt: 'verifiedAt',
  extractedMetadataJson: 'extractedMetadataJson',
  reviewerNotes: 'reviewerNotes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditFindingStatusHistoryScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  findingId: 'findingId',
  previousStatus: 'previousStatus',
  newStatus: 'newStatus',
  changedByUserId: 'changedByUserId',
  changedByRole: 'changedByRole',
  comment: 'comment',
  evidenceId: 'evidenceId',
  approvalLevel: 'approvalLevel',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditReviewScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  findingId: 'findingId',
  reviewerUserId: 'reviewerUserId',
  reviewerRole: 'reviewerRole',
  decision: 'decision',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditCaseScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  title: 'title',
  summary: 'summary',
  status: 'status',
  riskLevel: 'riskLevel',
  createdByUserId: 'createdByUserId',
  closedAt: 'closedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditCaseFindingScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  caseId: 'caseId',
  findingId: 'findingId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditBaselineScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  metricKey: 'metricKey',
  scopeKey: 'scopeKey',
  windowDays: 'windowDays',
  sampleCount: 'sampleCount',
  minimumSamples: 'minimumSamples',
  status: 'status',
  median: 'median',
  p25: 'p25',
  p75: 'p75',
  p90: 'p90',
  p99: 'p99',
  mean: 'mean',
  statsJson: 'statsJson',
  computedAt: 'computedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ActivityEventScalarFieldEnum = {
  id: 'id',
  eventId: 'eventId',
  shopId: 'shopId',
  userId: 'userId',
  orgId: 'orgId',
  deviceId: 'deviceId',
  sessionId: 'sessionId',
  eventType: 'eventType',
  module: 'module',
  screen: 'screen',
  appVersion: 'appVersion',
  networkStatus: 'networkStatus',
  source: 'source',
  durationMs: 'durationMs',
  metadataJson: 'metadataJson',
  occurredAt: 'occurredAt',
  createdAt: 'createdAt'
};

exports.Prisma.ActivityAggregateScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  userId: 'userId',
  kind: 'kind',
  key: 'key',
  label: 'label',
  count: 'count',
  score: 'score',
  totalMs: 'totalMs',
  durationSamples: 'durationSamples',
  metaJson: 'metaJson',
  firstSeenAt: 'firstSeenAt',
  lastSeenAt: 'lastSeenAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RentalBookingScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  bookingNumber: 'bookingNumber',
  customerId: 'customerId',
  customerName: 'customerName',
  customerPhone: 'customerPhone',
  customerAddress: 'customerAddress',
  idProofType: 'idProofType',
  idProofNumber: 'idProofNumber',
  fromDate: 'fromDate',
  toDate: 'toDate',
  returnedAt: 'returnedAt',
  status: 'status',
  rentAmount: 'rentAmount',
  depositAmount: 'depositAmount',
  advancePaid: 'advancePaid',
  lateFee: 'lateFee',
  damageCharge: 'damageCharge',
  notes: 'notes',
  createdByUserId: 'createdByUserId',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RentalBookingItemScalarFieldEnum = {
  id: 'id',
  bookingId: 'bookingId',
  productId: 'productId',
  name: 'name',
  unit: 'unit',
  qty: 'qty',
  ratePerDay: 'ratePerDay',
  amount: 'amount'
};

exports.Prisma.PrescriptionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  registerNumber: 'registerNumber',
  doctorName: 'doctorName',
  doctorRegNo: 'doctorRegNo',
  doctorClinic: 'doctorClinic',
  customerId: 'customerId',
  patientName: 'patientName',
  patientPhone: 'patientPhone',
  patientAge: 'patientAge',
  patientGender: 'patientGender',
  patientAddress: 'patientAddress',
  scheduleType: 'scheduleType',
  prescribedOn: 'prescribedOn',
  dispensedAt: 'dispensedAt',
  status: 'status',
  billId: 'billId',
  billNumber: 'billNumber',
  refillsAllowed: 'refillsAllowed',
  refillsUsed: 'refillsUsed',
  imageUrl: 'imageUrl',
  notes: 'notes',
  createdByUserId: 'createdByUserId',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PrescriptionItemScalarFieldEnum = {
  id: 'id',
  prescriptionId: 'prescriptionId',
  productId: 'productId',
  name: 'name',
  strength: 'strength',
  dosage: 'dosage',
  qty: 'qty',
  unit: 'unit',
  batchNumber: 'batchNumber',
  substitutedFor: 'substitutedFor'
};

exports.Prisma.ProductUnitScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  productId: 'productId',
  productName: 'productName',
  imei: 'imei',
  imei2: 'imei2',
  serialNumber: 'serialNumber',
  status: 'status',
  condition: 'condition',
  purchaseBillId: 'purchaseBillId',
  supplierId: 'supplierId',
  costPrice: 'costPrice',
  receivedAt: 'receivedAt',
  billId: 'billId',
  billNumber: 'billNumber',
  customerId: 'customerId',
  customerName: 'customerName',
  customerPhone: 'customerPhone',
  soldAt: 'soldAt',
  sellingPrice: 'sellingPrice',
  warrantyMonths: 'warrantyMonths',
  warrantyUntil: 'warrantyUntil',
  notes: 'notes',
  createdByUserId: 'createdByUserId',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PartFitmentScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  productId: 'productId',
  productName: 'productName',
  make: 'make',
  model: 'model',
  variant: 'variant',
  yearFrom: 'yearFrom',
  yearTo: 'yearTo',
  notes: 'notes',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PartCrossReferenceScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  productId: 'productId',
  productName: 'productName',
  alternateProductId: 'alternateProductId',
  partNumber: 'partNumber',
  brand: 'brand',
  kind: 'kind',
  notes: 'notes',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FootwearSizeProfileScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  productId: 'productId',
  productName: 'productName',
  sizeSystem: 'sizeSystem',
  gender: 'gender',
  widthFit: 'widthFit',
  notes: 'notes',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BookListScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  schoolName: 'schoolName',
  className: 'className',
  academicYear: 'academicYear',
  name: 'name',
  notes: 'notes',
  isActive: 'isActive',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BookListItemScalarFieldEnum = {
  id: 'id',
  listId: 'listId',
  productId: 'productId',
  name: 'name',
  qty: 'qty',
  unit: 'unit',
  isOptional: 'isOptional',
  notes: 'notes',
  sortOrder: 'sortOrder'
};

exports.Prisma.FurnitureOrderScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  orderNumber: 'orderNumber',
  customerId: 'customerId',
  customerName: 'customerName',
  customerPhone: 'customerPhone',
  deliveryAddress: 'deliveryAddress',
  status: 'status',
  itemsTotal: 'itemsTotal',
  discount: 'discount',
  deliveryCharge: 'deliveryCharge',
  installCharge: 'installCharge',
  grandTotal: 'grandTotal',
  quotedOn: 'quotedOn',
  promisedOn: 'promisedOn',
  deliveredAt: 'deliveredAt',
  installedAt: 'installedAt',
  isCustom: 'isCustom',
  billId: 'billId',
  billNumber: 'billNumber',
  notes: 'notes',
  createdByUserId: 'createdByUserId',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FurnitureOrderItemScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  productId: 'productId',
  name: 'name',
  variant: 'variant',
  qty: 'qty',
  rate: 'rate',
  amount: 'amount',
  reserveStock: 'reserveStock',
  notes: 'notes'
};

exports.Prisma.FurnitureOrderPaymentScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  amount: 'amount',
  mode: 'mode',
  paidOn: 'paidOn',
  reference: 'reference',
  notes: 'notes',
  createdByUserId: 'createdByUserId',
  createdAt: 'createdAt'
};

exports.Prisma.TesterUnitScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  productId: 'productId',
  productName: 'productName',
  variant: 'variant',
  status: 'status',
  openedOn: 'openedOn',
  expectedDays: 'expectedDays',
  closedOn: 'closedOn',
  costValue: 'costValue',
  stockLedgerId: 'stockLedgerId',
  notes: 'notes',
  createdByUserId: 'createdByUserId',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RestaurantTableScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  code: 'code',
  name: 'name',
  section: 'section',
  seats: 'seats',
  selfOrderEnabled: 'selfOrderEnabled',
  active: 'active',
  sortOrder: 'sortOrder',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TableReservationScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  tableId: 'tableId',
  guestName: 'guestName',
  guestPhone: 'guestPhone',
  partySize: 'partySize',
  reservedFor: 'reservedFor',
  durationMinutes: 'durationMinutes',
  status: 'status',
  source: 'source',
  note: 'note',
  seatedAt: 'seatedAt',
  closedAt: 'closedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StaffShiftScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  userId: 'userId',
  startsAt: 'startsAt',
  endsAt: 'endsAt',
  position: 'position',
  status: 'status',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.KioskTerminalScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  code: 'code',
  name: 'name',
  active: 'active',
  requirePrepay: 'requirePrepay',
  lastSeenAt: 'lastSeenAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DishRecipeComponentScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  dishProductId: 'dishProductId',
  ingredientProductId: 'ingredientProductId',
  ingredientName: 'ingredientName',
  qtyBase: 'qtyBase',
  wastagePct: 'wastagePct',
  optional: 'optional',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.KitchenTicketScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  ticketNo: 'ticketNo',
  tableId: 'tableId',
  tableName: 'tableName',
  billId: 'billId',
  status: 'status',
  linesJson: 'linesJson',
  firedAt: 'firedAt',
  servedAt: 'servedAt',
  idempotencyKey: 'idempotencyKey',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MenuAddonGroupScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  name: 'name',
  minSelect: 'minSelect',
  maxSelect: 'maxSelect',
  sortOrder: 'sortOrder',
  isActive: 'isActive',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.MenuAddonOptionScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  groupId: 'groupId',
  name: 'name',
  priceDelta: 'priceDelta',
  priceDeltaPaise: 'priceDeltaPaise',
  linkedProductId: 'linkedProductId',
  linkedQtyBase: 'linkedQtyBase',
  sortOrder: 'sortOrder',
  isActive: 'isActive',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ProductAddonGroupScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  productId: 'productId',
  groupId: 'groupId',
  sortOrder: 'sortOrder'
};

exports.Prisma.BillItemAddonScalarFieldEnum = {
  id: 'id',
  billItemId: 'billItemId',
  optionId: 'optionId',
  groupName: 'groupName',
  name: 'name',
  price: 'price',
  pricePaise: 'pricePaise',
  quantity: 'quantity',
  createdAt: 'createdAt'
};

exports.Prisma.ChannelSettlementImportScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  locationId: 'locationId',
  provider: 'provider',
  fileName: 'fileName',
  fileHash: 'fileHash',
  mappingJson: 'mappingJson',
  periodFrom: 'periodFrom',
  periodTo: 'periodTo',
  rowCount: 'rowCount',
  grossPaise: 'grossPaise',
  calculatedNetPaise: 'calculatedNetPaise',
  paidNetPaise: 'paidNetPaise',
  variancePaise: 'variancePaise',
  status: 'status',
  importedByUserId: 'importedByUserId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ChannelSettlementRowScalarFieldEnum = {
  id: 'id',
  importId: 'importId',
  shopId: 'shopId',
  locationId: 'locationId',
  provider: 'provider',
  rowNumber: 'rowNumber',
  rowFingerprint: 'rowFingerprint',
  externalOrderId: 'externalOrderId',
  orderDate: 'orderDate',
  channelStatus: 'channelStatus',
  currency: 'currency',
  grossPaise: 'grossPaise',
  merchantDiscountPaise: 'merchantDiscountPaise',
  platformCommissionPaise: 'platformCommissionPaise',
  paymentFeePaise: 'paymentFeePaise',
  taxOnFeesPaise: 'taxOnFeesPaise',
  tcsPaise: 'tcsPaise',
  tdsPaise: 'tdsPaise',
  adjustmentPaise: 'adjustmentPaise',
  refundPaise: 'refundPaise',
  providerExpectedNetPaise: 'providerExpectedNetPaise',
  calculatedExpectedNetPaise: 'calculatedExpectedNetPaise',
  paidNetPaise: 'paidNetPaise',
  variancePaise: 'variancePaise',
  mismatchTypesJson: 'mismatchTypesJson',
  matchStatus: 'matchStatus',
  candidateCustomerOrderId: 'candidateCustomerOrderId',
  candidateBillId: 'candidateBillId',
  matchedCustomerOrderId: 'matchedCustomerOrderId',
  matchedBillId: 'matchedBillId',
  bankStatementTransactionId: 'bankStatementTransactionId',
  resolutionStatus: 'resolutionStatus',
  resolutionNote: 'resolutionNote',
  resolvedByUserId: 'resolvedByUserId',
  resolvedAt: 'resolvedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ChannelSettlementEventScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  rowId: 'rowId',
  action: 'action',
  previousJson: 'previousJson',
  nextJson: 'nextJson',
  reason: 'reason',
  actorUserId: 'actorUserId',
  createdAt: 'createdAt'
};

exports.Prisma.MenuComboComponentScalarFieldEnum = {
  id: 'id',
  shopId: 'shopId',
  comboProductId: 'comboProductId',
  componentProductId: 'componentProductId',
  componentName: 'componentName',
  quantity: 'quantity',
  sortOrder: 'sortOrder',
  note: 'note',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};


exports.Prisma.ModelName = {
  Shop: 'Shop',
  ShopMaintenanceLock: 'ShopMaintenanceLock',
  PricingRule: 'PricingRule',
  ProductSellingUnit: 'ProductSellingUnit',
  PricingDecisionEvent: 'PricingDecisionEvent',
  CustomerOrder: 'CustomerOrder',
  RestaurantGuestRequest: 'RestaurantGuestRequest',
  BillCounter: 'BillCounter',
  User: 'User',
  AuthToken: 'AuthToken',
  Session: 'Session',
  Product: 'Product',
  Customer: 'Customer',
  Bill: 'Bill',
  BillItem: 'BillItem',
  Payment: 'Payment',
  RetailPaymentIntent: 'RetailPaymentIntent',
  PaymentProviderConnection: 'PaymentProviderConnection',
  StoreLocation: 'StoreLocation',
  LocationStock: 'LocationStock',
  StorageBin: 'StorageBin',
  BinPlacement: 'BinPlacement',
  StockCountSession: 'StockCountSession',
  StockCountLine: 'StockCountLine',
  GiftCard: 'GiftCard',
  GiftCardTransaction: 'GiftCardTransaction',
  StockTransfer: 'StockTransfer',
  StockTransferItem: 'StockTransferItem',
  StockTransferLotAllocation: 'StockTransferLotAllocation',
  TransferDocumentCounter: 'TransferDocumentCounter',
  LoyaltyProgram: 'LoyaltyProgram',
  LoyaltyAccount: 'LoyaltyAccount',
  LoyaltyTransaction: 'LoyaltyTransaction',
  ComplianceDocument: 'ComplianceDocument',
  StockLedger: 'StockLedger',
  UdharLedger: 'UdharLedger',
  TallyPost: 'TallyPost',
  Supplier: 'Supplier',
  Expense: 'Expense',
  Offer: 'Offer',
  PurchaseHistory: 'PurchaseHistory',
  PurchaseOrder: 'PurchaseOrder',
  PurchaseOrderItem: 'PurchaseOrderItem',
  PurchaseReceipt: 'PurchaseReceipt',
  PurchaseReceiptItem: 'PurchaseReceiptItem',
  PurchaseReturn: 'PurchaseReturn',
  PurchaseReturnItem: 'PurchaseReturnItem',
  InventoryLot: 'InventoryLot',
  ManufacturingBom: 'ManufacturingBom',
  ManufacturingBomItem: 'ManufacturingBomItem',
  ProductionRun: 'ProductionRun',
  ProductionConsumption: 'ProductionConsumption',
  ProductionOutput: 'ProductionOutput',
  TradeOrder: 'TradeOrder',
  TradeOrderItem: 'TradeOrderItem',
  TradeOrderAllocation: 'TradeOrderAllocation',
  TradeDispatch: 'TradeDispatch',
  BillItemLotAllocation: 'BillItemLotAllocation',
  UserLocationAccess: 'UserLocationAccess',
  AiActionLog: 'AiActionLog',
  AuditLog: 'AuditLog',
  DailyClosingSnapshot: 'DailyClosingSnapshot',
  ReportExportJob: 'ReportExportJob',
  BackupArtifact: 'BackupArtifact',
  ReminderTemplate: 'ReminderTemplate',
  ReminderLog: 'ReminderLog',
  ReminderDeliveryEvent: 'ReminderDeliveryEvent',
  OfflineSyncEvent: 'OfflineSyncEvent',
  SyncConflict: 'SyncConflict',
  SyncCommand: 'SyncCommand',
  ChangeLog: 'ChangeLog',
  FinancialLedger: 'FinancialLedger',
  ChartOfAccount: 'ChartOfAccount',
  JournalEntry: 'JournalEntry',
  JournalLine: 'JournalLine',
  AccountingPeriod: 'AccountingPeriod',
  AccountingDocument: 'AccountingDocument',
  AccountingDocumentEvent: 'AccountingDocumentEvent',
  BankStatementImport: 'BankStatementImport',
  BankStatementTransaction: 'BankStatementTransaction',
  BankReconciliationAllocation: 'BankReconciliationAllocation',
  BankReconciliationEvent: 'BankReconciliationEvent',
  SyncIdMapping: 'SyncIdMapping',
  ErrorGroup: 'ErrorGroup',
  ErrorEvent: 'ErrorEvent',
  SupportRequest: 'SupportRequest',
  DeviceHealthSnapshot: 'DeviceHealthSnapshot',
  SupportSession: 'SupportSession',
  DeviceCommand: 'DeviceCommand',
  Plan: 'Plan',
  Subscription: 'Subscription',
  OnboardingPurchase: 'OnboardingPurchase',
  PaymentTransaction: 'PaymentTransaction',
  PaymentProviderEvent: 'PaymentProviderEvent',
  IntegrationApiKey: 'IntegrationApiKey',
  WebhookEndpoint: 'WebhookEndpoint',
  WebhookDelivery: 'WebhookDelivery',
  Device: 'Device',
  DeviceReplacementChallenge: 'DeviceReplacementChallenge',
  DeviceLicense: 'DeviceLicense',
  AuditRule: 'AuditRule',
  AuditRun: 'AuditRun',
  AuditEvaluation: 'AuditEvaluation',
  AuditFinding: 'AuditFinding',
  AuditFindingRule: 'AuditFindingRule',
  AuditEvidenceRequirement: 'AuditEvidenceRequirement',
  AuditEvidence: 'AuditEvidence',
  AuditFindingStatusHistory: 'AuditFindingStatusHistory',
  AuditReview: 'AuditReview',
  AuditCase: 'AuditCase',
  AuditCaseFinding: 'AuditCaseFinding',
  AuditBaseline: 'AuditBaseline',
  ActivityEvent: 'ActivityEvent',
  ActivityAggregate: 'ActivityAggregate',
  RentalBooking: 'RentalBooking',
  RentalBookingItem: 'RentalBookingItem',
  Prescription: 'Prescription',
  PrescriptionItem: 'PrescriptionItem',
  ProductUnit: 'ProductUnit',
  PartFitment: 'PartFitment',
  PartCrossReference: 'PartCrossReference',
  FootwearSizeProfile: 'FootwearSizeProfile',
  BookList: 'BookList',
  BookListItem: 'BookListItem',
  FurnitureOrder: 'FurnitureOrder',
  FurnitureOrderItem: 'FurnitureOrderItem',
  FurnitureOrderPayment: 'FurnitureOrderPayment',
  TesterUnit: 'TesterUnit',
  RestaurantTable: 'RestaurantTable',
  TableReservation: 'TableReservation',
  StaffShift: 'StaffShift',
  KioskTerminal: 'KioskTerminal',
  DishRecipeComponent: 'DishRecipeComponent',
  KitchenTicket: 'KitchenTicket',
  MenuAddonGroup: 'MenuAddonGroup',
  MenuAddonOption: 'MenuAddonOption',
  ProductAddonGroup: 'ProductAddonGroup',
  BillItemAddon: 'BillItemAddon',
  ChannelSettlementImport: 'ChannelSettlementImport',
  ChannelSettlementRow: 'ChannelSettlementRow',
  ChannelSettlementEvent: 'ChannelSettlementEvent',
  MenuComboComponent: 'MenuComboComponent'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)

-- Which drug schedule a medicine falls under, so a Schedule H sale can be
-- refused without a prescription instead of merely recorded next to one.
--
-- The prescription register already existed and was well built, but nothing
-- upstream of it knew that a given product was restricted. A pharmacy could
-- therefore bill Schedule H without any slip at all and the register would stay
-- silent, because writing an entry was voluntary.
--
-- Values: h | h1 | x | otc. Null means "not a scheduled drug", which is every
-- product in every non-pharmacy shop and every medicine nobody has classified
-- yet. That nullability is the whole safety story: enforcement is driven by the
-- data, so an unclassified catalogue behaves exactly as it does today and a shop
-- opts in one product at a time by marking it.
ALTER TABLE "Product" ADD COLUMN "drugSchedule" TEXT;

-- The billing check asks "is anything on this bill restricted?" per sale, so the
-- lookup is by shop and schedule.
CREATE INDEX "Product_shopId_drugSchedule_idx" ON "Product"("shopId", "drugSchedule");

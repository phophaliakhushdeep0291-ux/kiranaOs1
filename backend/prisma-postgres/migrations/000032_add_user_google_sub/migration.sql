-- Google sign-in: store the Google account id (ID-token `sub`) once an account links.
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;
CREATE INDEX "User_googleSub_idx" ON "User"("googleSub");

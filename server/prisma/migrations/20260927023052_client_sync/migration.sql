-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "invoiceNinjaSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Client_invoiceNinjaClientId_key" ON "Client"("invoiceNinjaClientId");


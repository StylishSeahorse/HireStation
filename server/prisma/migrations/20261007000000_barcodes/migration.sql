-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "barcode" TEXT;

-- AlterTable
ALTER TABLE "EquipmentUnit" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_barcode_key" ON "Equipment"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentUnit_barcode_key" ON "EquipmentUnit"("barcode");


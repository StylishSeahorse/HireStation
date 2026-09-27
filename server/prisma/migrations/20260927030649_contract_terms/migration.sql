-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BookingLineItem" ADD COLUMN     "conditionNote" TEXT;

-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "termsBalanceDue" TEXT,
ADD COLUMN     "termsBondRefundDays" INTEGER,
ADD COLUMN     "termsCancelDepositDays" INTEGER,
ADD COLUMN     "termsCancelLateDays" INTEGER,
ADD COLUMN     "termsCancelLatePct" INTEGER,
ADD COLUMN     "termsExtensionNotice" TEXT,
ADD COLUMN     "termsLatePaymentPct" TEXT,
ADD COLUMN     "termsLateReturnFee" TEXT;

-- AlterTable
ALTER TABLE "ContractTemplate" ADD COLUMN     "equipmentOverflow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "equipmentRows" INTEGER;


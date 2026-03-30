import type {
  RunInput,
  FunctionRunResult,
  Discount
} from "../generated/api";
import {
  DiscountApplicationStrategy,
} from "../generated/api";

const EMPTY_DISCOUNT: FunctionRunResult = {
  discountApplicationStrategy: DiscountApplicationStrategy.All,
  discounts: [],
};

export function run(input: RunInput): FunctionRunResult {
  const customer = input.cart?.buyerIdentity?.customer;
  const isB2B = customer?.hasAnyTag;

  if (!isB2B) {
    return EMPTY_DISCOUNT;
  }

  const discounts: Discount[] = [];

  for (const line of input.cart.lines) {
    const variant = line.merchandise;

    if (variant.__typename === "ProductVariant" && variant.metafield?.value) {
      const originalPrice = parseFloat(line.cost.amountPerQuantity.amount);
      const b2bPrice = parseFloat(variant.metafield.value);

      if (isNaN(originalPrice) || isNaN(b2bPrice)) continue;

      const discountAmount = originalPrice - b2bPrice;

      if (discountAmount > 0) {
        discounts.push({
          targets: [
            {
              productVariant: {
                id: variant.id
              }
            }
          ],
          value: {
            fixedAmount: {
              amount: discountAmount.toFixed(2),
              appliesToEachItem: true
            }
          },
          message: "B2B Özel Fiyat"
        });
      }
    }
  }

  if (discounts.length === 0) {
    return EMPTY_DISCOUNT;
  }

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.All,
    discounts: discounts
  };
};


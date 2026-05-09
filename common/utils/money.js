// server/common/utils/money.js
//
// Money handling using integer minor units + currency code.
// NEVER use float for money — JS Float will eat your kopecks.
//
// Usage:
//   const price = Money.fromMajor(123.50, "AZN");  // 12350 AZN minor units
//   const tax = price.multiply(0.18);
//   const total = price.add(tax);
//   console.log(total.toMajor());  // 145.73
//
//   // Distribute revenue between doctors without losing minor units:
//   const revenue = Money.fromMajor(100, "AZN");
//   const shares = revenue.allocate([1, 1, 1]);  // [33.34, 33.33, 33.33]

import Decimal from "decimal.js";

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const VALID_CURRENCIES = [
  "AZN",
  "USD",
  "EUR",
  "TRY",
  "RUB",
  "GBP",
  "AED",
  "SAR",
];

export class Money {
  /**
   * @param {number} amount  Integer minor units (e.g. 12350 = 123.50)
   * @param {string} currency  ISO-4217 currency code (3 letters)
   */
  constructor(amount, currency) {
    if (!Number.isInteger(amount)) {
      throw new Error(
        `Money amount must be integer (minor units), got: ${amount}`,
      );
    }
    if (typeof currency !== "string" || currency.length !== 3) {
      throw new Error(`Invalid currency code: ${currency}`);
    }
    const upper = currency.toUpperCase();
    if (!VALID_CURRENCIES.includes(upper)) {
      throw new Error(
        `Unsupported currency: ${upper}. Supported: ${VALID_CURRENCIES.join(", ")}`,
      );
    }
    this.amount = amount;
    this.currency = upper;
    Object.freeze(this);
  }

  /**
   * Create from "human" amount (e.g. 123.50 → 12350 minor units).
   */
  static fromMajor(majorAmount, currency) {
    const dec = new Decimal(majorAmount).times(100);
    if (!dec.isInteger()) {
      // round half-up for safety
      const rounded = dec.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      return new Money(rounded.toNumber(), currency);
    }
    return new Money(dec.toNumber(), currency);
  }

  /**
   * Zero amount in given currency.
   */
  static zero(currency) {
    return new Money(0, currency);
  }

  /**
   * Restore from JSON: { amount: 12350, currency: "AZN" }
   */
  static fromJSON(json) {
    if (!json || typeof json !== "object") {
      throw new Error("Money.fromJSON expects an object");
    }
    return new Money(json.amount, json.currency);
  }

  /**
   * Convert minor units → major (e.g. 12350 → 123.50).
   */
  toMajor() {
    return new Decimal(this.amount).div(100).toNumber();
  }

  add(other) {
    this._assertSameCurrency(other);
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other) {
    this._assertSameCurrency(other);
    return new Money(this.amount - other.amount, this.currency);
  }

  multiply(factor) {
    if (typeof factor !== "number" && !(factor instanceof Decimal)) {
      throw new Error("multiply expects a number or Decimal");
    }
    const result = new Decimal(this.amount)
      .times(factor)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    return new Money(result.toNumber(), this.currency);
  }

  /**
   * Distribute amount between N recipients by ratios, without losing minor units.
   * Example: 100.00 AZN allocated by [1, 1, 1] → [33.34, 33.33, 33.33]
   *
   * @param {number[]} ratios  Array of positive numbers (any scale)
   * @returns {Money[]}
   */
  allocate(ratios) {
    if (!Array.isArray(ratios) || ratios.length === 0) {
      throw new Error("allocate expects a non-empty array of ratios");
    }
    if (ratios.some((r) => r < 0)) {
      throw new Error("allocate ratios must be non-negative");
    }
    const total = ratios.reduce((s, r) => s + r, 0);
    if (total === 0) {
      throw new Error("allocate ratios sum to zero");
    }

    let remainder = this.amount;
    const shares = ratios.map((r) => {
      const share = Math.floor((this.amount * r) / total);
      remainder -= share;
      return share;
    });
    // Distribute the leftover to the first N shares
    for (let i = 0; i < remainder; i++) {
      shares[i % shares.length] += 1;
    }
    return shares.map((s) => new Money(s, this.currency));
  }

  isZero() {
    return this.amount === 0;
  }
  isPositive() {
    return this.amount > 0;
  }
  isNegative() {
    return this.amount < 0;
  }

  equals(other) {
    return (
      other instanceof Money &&
      this.amount === other.amount &&
      this.currency === other.currency
    );
  }

  greaterThan(other) {
    this._assertSameCurrency(other);
    return this.amount > other.amount;
  }

  lessThan(other) {
    this._assertSameCurrency(other);
    return this.amount < other.amount;
  }

  toJSON() {
    return { amount: this.amount, currency: this.currency };
  }

  toString() {
    return `${this.toMajor().toFixed(2)} ${this.currency}`;
  }

  _assertSameCurrency(other) {
    if (!(other instanceof Money)) {
      throw new Error("Other operand must be a Money instance");
    }
    if (this.currency !== other.currency) {
      throw new Error(
        `Currency mismatch: ${this.currency} vs ${other.currency}`,
      );
    }
  }
}

/**
 * Mongoose schema definition for embedding Money in models.
 *
 *   const invoiceSchema = new Schema({
 *     total: moneySchemaDef,
 *     ...
 *   });
 */
export const moneySchemaDef = {
  amount: { type: Number, required: true, validate: Number.isInteger },
  currency: { type: String, required: true, uppercase: true, length: 3 },
};

/**
 * Helper: serialize Money to schema-shaped plain object.
 */
export function moneyToPlain(money) {
  if (!money) return null;
  if (money instanceof Money) return money.toJSON();
  return money;
}

/**
 * Helper: deserialize plain object back to Money.
 */
export function plainToMoney(plain) {
  if (!plain) return null;
  if (plain instanceof Money) return plain;
  return Money.fromJSON(plain);
}

import { describe, it, expect } from "vitest";
import {
  Money,
  moneySchemaDef,
  moneyToPlain,
  plainToMoney,
} from "../../common/utils/money.js";

describe("Money — basics", () => {
  it("creates from major amount", () => {
    const m = Money.fromMajor(123.5, "AZN");
    expect(m.amount).toBe(12350);
    expect(m.currency).toBe("AZN");
  });

  it("rejects non-integer minor units", () => {
    expect(() => new Money(123.5, "AZN")).toThrow(/integer/i);
  });

  it("rejects invalid currency", () => {
    expect(() => new Money(100, "XX")).toThrow(/currency/i);
    expect(() => new Money(100, "FOO")).toThrow(/Unsupported/i);
  });

  it("converts back to major", () => {
    expect(Money.fromMajor(99.99, "USD").toMajor()).toBe(99.99);
  });

  it("zero factory", () => {
    const z = Money.zero("EUR");
    expect(z.amount).toBe(0);
    expect(z.isZero()).toBe(true);
  });

  it("normalizes currency to uppercase", () => {
    expect(new Money(100, "azn").currency).toBe("AZN");
  });
});

describe("Money — arithmetic", () => {
  it("adds same currency", () => {
    const sum = Money.fromMajor(10, "AZN").add(Money.fromMajor(20, "AZN"));
    expect(sum.toMajor()).toBe(30);
  });

  it("subtracts same currency", () => {
    const diff = Money.fromMajor(50, "AZN").subtract(
      Money.fromMajor(20, "AZN"),
    );
    expect(diff.toMajor()).toBe(30);
  });

  it("rejects currency mismatch on add", () => {
    expect(() =>
      Money.fromMajor(100, "AZN").add(Money.fromMajor(50, "USD")),
    ).toThrow(/Currency mismatch/);
  });

  it("multiplies by float without rounding loss", () => {
    const tax = Money.fromMajor(123.5, "AZN").multiply(0.18);
    expect(tax.toMajor()).toBe(22.23);
  });

  it("isPositive / isNegative", () => {
    expect(Money.fromMajor(10, "AZN").isPositive()).toBe(true);
    expect(Money.fromMajor(-10, "AZN").isNegative()).toBe(true);
    expect(Money.zero("AZN").isPositive()).toBe(false);
  });

  it("compares with greaterThan / lessThan", () => {
    const a = Money.fromMajor(100, "AZN");
    const b = Money.fromMajor(50, "AZN");
    expect(a.greaterThan(b)).toBe(true);
    expect(b.lessThan(a)).toBe(true);
  });
});

describe("Money — allocation", () => {
  it("100 AZN distributed by [1,1,1] = 33.34, 33.33, 33.33", () => {
    const shares = Money.fromMajor(100, "AZN").allocate([1, 1, 1]);
    expect(shares.map((s) => s.toMajor())).toEqual([33.34, 33.33, 33.33]);
  });

  it("allocation does not lose minor units", () => {
    const total = Money.fromMajor(100, "AZN");
    const shares = total.allocate([1, 1, 1]);
    const sum = shares.reduce((acc, s) => acc.add(s), Money.zero("AZN"));
    expect(sum.equals(total)).toBe(true);
  });

  it("allocates by uneven ratios", () => {
    const total = Money.fromMajor(1000, "AZN");
    const shares = total.allocate([7, 2, 1]);
    expect(shares.map((s) => s.toMajor())).toEqual([700, 200, 100]);
  });

  it("rejects empty ratios", () => {
    expect(() => Money.fromMajor(100, "AZN").allocate([])).toThrow();
  });

  it("rejects all-zero ratios", () => {
    expect(() => Money.fromMajor(100, "AZN").allocate([0, 0, 0])).toThrow();
  });

  it("rejects negative ratios", () => {
    expect(() => Money.fromMajor(100, "AZN").allocate([1, -1])).toThrow();
  });
});

describe("Money — JSON serialization", () => {
  it("toJSON / fromJSON roundtrip", () => {
    const original = Money.fromMajor(99.99, "USD");
    const json = original.toJSON();
    expect(json).toEqual({ amount: 9999, currency: "USD" });
    const restored = Money.fromJSON(json);
    expect(restored.equals(original)).toBe(true);
  });

  it("toString format", () => {
    expect(Money.fromMajor(123.5, "AZN").toString()).toBe("123.50 AZN");
  });

  it("moneyToPlain / plainToMoney helpers", () => {
    const m = Money.fromMajor(50, "EUR");
    const plain = moneyToPlain(m);
    expect(plain).toEqual({ amount: 5000, currency: "EUR" });
    const back = plainToMoney(plain);
    expect(back.equals(m)).toBe(true);
  });

  it("moneyToPlain handles null", () => {
    expect(moneyToPlain(null)).toBeNull();
    expect(plainToMoney(null)).toBeNull();
  });
});

describe("Money — schema definition", () => {
  it("exports moneySchemaDef for Mongoose", () => {
    expect(moneySchemaDef).toBeDefined();
    expect(moneySchemaDef.amount.required).toBe(true);
    expect(moneySchemaDef.currency.required).toBe(true);
    expect(moneySchemaDef.currency.length).toBe(3);
  });
});

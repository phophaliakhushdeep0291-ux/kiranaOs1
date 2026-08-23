import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  parseCustomerVoiceAnswer,
  parseSpokenCustomerFields,
} from "@/features/core/customers/customer-voice-parser";
import {
  applyCustomerVoiceFields,
  isCustomerReadyToSave,
  nextCustomerVoiceField,
  type CustomerVoiceFormValues,
} from "@/features/core/customers/customer-voice-session";

function emptyForm(overrides: Partial<CustomerVoiceFormValues> = {}): CustomerVoiceFormValues {
  return {
    name: "",
    mobile: "",
    address: "",
    gstNumber: "",
    stateCode: "",
    type: "regular",
    dueDate: "",
    promiseToPayDate: "",
    udharLimit: "",
    notes: "",
    ...overrides,
  };
}

describe("customer voice parser — one natural sentence", () => {
  it("reads every field a full sentence states", () => {
    const fields = parseSpokenCustomerFields(
      "add customer Ramesh Kumar mobile 9876543210 address MI Road Jaipur khata udhar limit 5000",
    );

    expect(fields).toMatchObject({
      name: "Ramesh Kumar",
      mobile: "9876543210",
      address: "MI Road Jaipur",
      udharLimit: 5000,
      type: "udhar",
    });
  });

  // A customer name goes on the bill and into the reminder message, so unlike a
  // product it keeps the casing it was spoken with.
  it("keeps the spoken casing of a name", () => {
    expect(parseSpokenCustomerFields("add customer Ramesh Kumar mobile 9876543210").name).toBe("Ramesh Kumar");
  });

  // Each of these filed a corrupted customer name before the labels were consumed.
  it.each([
    ["add customer Ramesh Kumar mobile 9876543210", "Ramesh Kumar"],
    ["new customer Suresh Sharma phone 9812345678 khata", "Suresh Sharma"],
    ["add customer Anita mobile 9876543210 note bad customer", "Anita"],
    ["add customer Ramesh Kumar mobile 9876543210 address 12 Station Road", "Ramesh Kumar"],
  ])("keeps field words out of the name: %s", (spoken, name) => {
    expect(parseSpokenCustomerFields(spoken).name).toBe(name);
  });

  // A ten-digit number is almost never dictated as ten digits in a row.
  it("joins a mobile number spoken in groups", () => {
    expect(parseSpokenCustomerFields("add customer Vijay mobile 98765 43210").mobile).toBe("9876543210");
  });

  it("keeps a house number in the address", () => {
    expect(parseSpokenCustomerFields("add customer Ramesh mobile 9876543210 address 12 Station Road").address).toBe(
      "12 Station Road",
    );
  });

  it("takes the state code only from a GSTIN that passes its own checksum", () => {
    const valid = parseSpokenCustomerFields("add customer Ramesh Kumar 9876543210 gst 27AAPFU0939F1ZV");
    expect(valid.gstNumber).toBe("27AAPFU0939F1ZV");
    expect(valid.stateCode).toBe("27");

    // Same shape, wrong check digit. Filing this under state 08 would put the
    // customer in a state the tax return then disagrees with.
    const invalid = parseSpokenCustomerFields("add customer Ramesh Kumar 9876543210 gst 08AABCU9603R1ZM");
    expect(invalid.gstNumber).toBe("08AABCU9603R1ZM");
    expect(invalid.stateCode).toBeUndefined();
  });

  // Nobody sets a credit limit on a customer who pays cash.
  it("makes a stated credit limit turn the customer into a khata account", () => {
    const fields = parseSpokenCustomerFields("add customer Ramesh mobile 9876543210 udhar limit 5000");
    expect(fields.udharLimit).toBe(5000);
    expect(fields.type).toBe("udhar");
  });

  // A limit is spoken the way money is spoken. Read one token at a time,
  // "paanch hazaar" came back as 5, so a ₹5,000 limit was filed as ₹5.
  it.each([
    ["add customer Ramesh mobile 9876543210 udhar limit paanch hazaar", 5000],
    ["add customer Ramesh mobile 9876543210 udhar limit ek lakh", 100000],
    ["add customer Ramesh mobile 9876543210 udhar limit do sau pachas", 250],
    ["add customer Ramesh mobile 9876543210 udhar limit 5000", 5000],
  ])("reads a credit limit said as words: %s", (spoken, limit) => {
    expect(parseSpokenCustomerFields(spoken).udharLimit).toBe(limit);
  });

  it("reads a credit limit said as Hindi words", () => {
    expect(parseSpokenCustomerFields("नया ग्राहक रमेश मोबाइल 9876543210 उधार सीमा पांच हज़ार").udharLimit).toBe(5000);
  });

  // A label the speaker abandoned is not part of anybody's name.
  it.each([
    "add customer Ramesh mobile 9876543210 address",
    "add customer Ramesh address mobile 9876543210",
    "add customer Ramesh Kumar mobile 9876543210 note",
  ])("drops a label that was said with no value after it: %s", (spoken) => {
    expect(parseSpokenCustomerFields(spoken).name).toMatch(/^Ramesh( Kumar)?$/);
  });

  // ...but an ordinary word that happens to be a label elsewhere is still a name.
  it("keeps a label word that is part of a name", () => {
    expect(parseSpokenCustomerFields("add customer Sunil Number Wala mobile 9876543210").name).toBe(
      "Sunil Number Wala",
    );
  });

});

describe("customer voice parser — Hindi", () => {
  it("reads a Hindi sentence", () => {
    expect(parseSpokenCustomerFields("नया ग्राहक रमेश मोबाइल 9876543210 उधार सीमा 5000")).toMatchObject({
      name: "रमेश",
      mobile: "9876543210",
      udharLimit: 5000,
      type: "udhar",
    });
  });

  it("reads a Hindi address without swallowing the label", () => {
    expect(parseSpokenCustomerFields("ग्राहक सुरेश का पता एमआई रोड जयपुर मोबाइल 9812345678")).toMatchObject({
      name: "सुरेश",
      address: "एमआई रोड जयपुर",
      mobile: "9812345678",
    });
  });

  it("reads the same sentence typed in Latin letters", () => {
    expect(parseSpokenCustomerFields("naya grahak ramesh mobile 9876543210 udhar limit 5000")).toMatchObject({
      name: "ramesh",
      mobile: "9876543210",
      udharLimit: 5000,
      type: "udhar",
    });
  });
});

describe("answering one question at a time", () => {
  it("reads a bare number as the field being asked for", () => {
    expect(parseCustomerVoiceAnswer("mobile", "9876543210")).toEqual({ mobile: "9876543210" });
    expect(parseCustomerVoiceAnswer("udharLimit", "5000")).toEqual({ udharLimit: 5000, type: "udhar" });
  });

  it("reads a bare name without needing the word name", () => {
    expect(parseCustomerVoiceAnswer("name", "Ramesh Kumar")).toEqual({ name: "Ramesh Kumar" });
  });

  it("reads a bare address, digits and all", () => {
    expect(parseCustomerVoiceAnswer("address", "12 Station Road")).toEqual({ address: "12 Station Road" });
  });

  it("takes a named field as a correction instead of the pending answer", () => {
    // Asked for the mobile, told the address: it has to land in the address.
    expect(parseCustomerVoiceAnswer("mobile", "address Sardarpura")).toMatchObject({ address: "Sardarpura" });
  });

  it("returns nothing when the answer holds no value for the field", () => {
    expect(parseCustomerVoiceAnswer("mobile", "hmm")).toEqual({});
  });
});

describe("what to ask next", () => {
  it("asks for the two fields the form cannot save without, in order", () => {
    expect(nextCustomerVoiceField(emptyForm(), new Set())).toBe("name");
    expect(nextCustomerVoiceField(emptyForm({ name: "Ramesh" }), new Set())).toBe("mobile");
  });

  // Ten digits the form would reject is a mishearing, not an answer; letting it
  // pass only moves the failure to a red toast at the Save button.
  it("asks again when the mobile heard is not one the form would accept", () => {
    expect(nextCustomerVoiceField(emptyForm({ name: "Ramesh", mobile: "1234567890" }), new Set())).toBe("mobile");
  });

  // Asking a cash customer for their limit invites an answer that quietly turns
  // them into a credit account.
  it("asks for a credit limit only once the customer is known to be on khata", () => {
    const cash = emptyForm({ name: "Ramesh", mobile: "9876543210", address: "MI Road" });
    expect(nextCustomerVoiceField(cash, new Set())).toBeNull();

    const khata = { ...cash, type: "udhar" as const };
    expect(nextCustomerVoiceField(khata, new Set())).toBe("udharLimit");
  });

  it("stops asking once the worthwhile fields are handled", () => {
    const form = emptyForm({ name: "Ramesh", mobile: "9876543210" });
    expect(nextCustomerVoiceField(form, new Set(["address"]))).toBeNull();
  });

  it("asks again for a required field that was skipped", () => {
    // Skipping the name still cannot save, so it comes back around.
    expect(nextCustomerVoiceField(emptyForm({ mobile: "9876543210" }), new Set(["name", "address"]))).toBe("name");
  });
});

describe("folding voice into the customer form", () => {
  it("fills the form from one sentence and leaves it saveable", () => {
    const filled = applyCustomerVoiceFields(
      emptyForm(),
      parseSpokenCustomerFields("add customer Ramesh Kumar mobile 9876543210 address MI Road Jaipur udhar limit 5000"),
    );

    expect(filled).toMatchObject({
      name: "Ramesh Kumar",
      mobile: "9876543210",
      address: "MI Road Jaipur",
      type: "udhar",
      udharLimit: "5000",
    });
    expect(isCustomerReadyToSave(filled)).toBe(true);
    expect(nextCustomerVoiceField(filled, new Set())).toBeNull();
  });

  it("leaves untouched fields exactly as they were", () => {
    const before = emptyForm({ name: "Ramesh", notes: "pays on time", address: "MI Road" });
    const after = applyCustomerVoiceFields(before, parseCustomerVoiceAnswer("mobile", "9876543210"));

    expect(after.mobile).toBe("9876543210");
    expect(after.notes).toBe("pays on time");
    expect(after.address).toBe("MI Road");
    expect(after.name).toBe("Ramesh");
  });

  it("is not saveable on a name alone", () => {
    expect(isCustomerReadyToSave(emptyForm({ name: "Ramesh" }))).toBe(false);
  });
});

// Every spoken date is relative to today — "next Friday", and a bare month that
// rolls into next year once it has passed. Read against the real clock these
// assertions pass until the date they name and then fail for ever, so the clock
// is pinned to a known Sunday instead.
describe("spoken dates, against a fixed clock", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 23, 12));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("reads a spoken date into the field that was named", () => {
    expect(
      parseSpokenCustomerFields(
        "new customer Suresh Sharma phone 9812345678 khata udhar limit 10000 due date 15 September",
      ),
    ).toMatchObject({ dueDate: "2026-09-15", udharLimit: 10000, type: "udhar" });
  });

  // The mic listens in hi-IN when the shop works in Hindi, so a Hindi month is
  // what comes back. Before the month table knew them the date was dropped AND
  // the label fell through into the name: "रमेश देय तारीख सितंबर".
  it("reads a Hindi month in a due date", () => {
    expect(parseSpokenCustomerFields("ग्राहक रमेश देय तारीख 15 सितंबर मोबाइल 9812345678")).toMatchObject({
      dueDate: "2026-09-15",
      name: "रमेश",
      mobile: "9812345678",
    });
  });

  // A month already past this year means next year — a promise to pay is always
  // ahead, and filing it behind would make the customer instantly overdue.
  it("rolls a month that has already gone by into next year", () => {
    expect(parseSpokenCustomerFields("customer Ramesh due date 15 January").dueDate).toBe("2027-01-15");
  });

  // ...but a year that was actually said is not guesswork, and used to be thrown
  // away, filing the date twelve months early.
  it("keeps a year that was spoken", () => {
    expect(parseSpokenCustomerFields("customer Ramesh due date 15 September 2027").dueDate).toBe("2027-09-15");
  });

  it("reads a relative promise date", () => {
    expect(parseCustomerVoiceAnswer("promiseToPayDate", "next Friday")).toEqual({
      promiseToPayDate: "2026-08-28",
    });
  });
});

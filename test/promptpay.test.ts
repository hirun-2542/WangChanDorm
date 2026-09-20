import { describe, expect, it } from "vitest";
import {
  buildPromptPayPayload,
  crc16CcittFalse,
  crc16CcittFalseHex,
  isValidPromptPayPayload,
  promptPayMerchantTarget,
  promptPayPayloadChecksum,
} from "../src/worker/lib/promptpay";

/** เบอร์เดียวกันที่ลูกค้ากรอกได้ทั้งแบบมี 0 นำ และไม่มี */
const phoneWithLeadingZero = "081-234-5678";
const phoneWithoutLeadingZero = "812-345-678";
const phoneTarget = "0066812345678";
const phoneTargetTlv = "01130066812345678";
const citizenId = "1234567890123";

describe("promptpay checksum", () => {
  it("computes the published CRC16-CCITT-FALSE check value", () => {
    expect(crc16CcittFalse("123456789")).toBe(0x29b1);
    expect(crc16CcittFalseHex("123456789")).toBe("29B1");
    expect(crc16CcittFalseHex("")).toBe("FFFF");
  });
});

describe("promptpay merchant target", () => {
  it("normalises a 9-digit and a 10-digit phone to the same target", () => {
    expect(promptPayMerchantTarget("phone", phoneWithLeadingZero)).toBe(phoneTarget);
    expect(promptPayMerchantTarget("phone", phoneWithoutLeadingZero)).toBe(phoneTarget);
    expect(promptPayMerchantTarget("phone", "812345678")).toBe(phoneTarget);

    const withoutLeadingZero = buildPromptPayPayload("phone", phoneWithoutLeadingZero, 4314);
    const withLeadingZero = buildPromptPayPayload("phone", phoneWithLeadingZero, 4314);

    expect(withoutLeadingZero).toContain(phoneTarget);
    expect(withoutLeadingZero).toContain(phoneTargetTlv);
    expect(withoutLeadingZero).toBe(withLeadingZero);
    expect(withoutLeadingZero).toBe("00020101021229370016A000000677010111011300668123456785802TH530376454074314.006304779F");
    expect(isValidPromptPayPayload(withoutLeadingZero)).toBe(true);
  });

  it("keeps a 13-digit citizen id as the merchant target", () => {
    expect(promptPayMerchantTarget("citizen-id", citizenId)).toBe(citizenId);

    const payload = buildPromptPayPayload("citizen-id", citizenId, 3745);

    expect(payload).toContain("02131234567890123");
    expect(payload).not.toContain(phoneTargetTlv);
    expect(isValidPromptPayPayload(payload)).toBe(true);
  });
});

describe("promptpay amount", () => {
  it("encodes satang as two decimals", () => {
    const payload = buildPromptPayPayload("phone", phoneWithoutLeadingZero, 90.5);

    expect(payload).toBe("00020101021229370016A000000677010111011300668123456785802TH5303764540590.5063046F59");
    expect(payload).toContain("540590.50");
    expect(payload).toContain(phoneTarget);
    expect(payload.slice(-4)).toBe(promptPayPayloadChecksum(payload));
    expect(isValidPromptPayPayload(payload)).toBe(true);
  });

  it("encodes a large amount without dropping the satang digits", () => {
    const payload = buildPromptPayPayload("phone", "0812345678", 1234567.5);

    expect(payload).toBe("00020101021229370016A000000677010111011300668123456785802TH530376454101234567.50630499D9");
    expect(payload).toContain("54101234567.50");
    expect(isValidPromptPayPayload(payload)).toBe(true);
  });
});

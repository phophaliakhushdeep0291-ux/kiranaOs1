import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCounterDrafts } from "@/lib/counter-draft";
import { prescriptionDraft, prescriptionFormDraft, emptyPrescriptionItem } from "@/features/verticals/pharmacy/prescriptions/prescription-draft";
import { PrescriptionPanel } from "@/features/verticals/pharmacy/prescriptions/components/PrescriptionPanel";
import type { Prescription } from "@/types/api";

const state = vi.hoisted(() => ({ scope: "pharmacy-session/main" }));
vi.mock("@/hooks/use-counter-draft", () => ({
  useCounterDraft: (draft: typeof prescriptionDraft) => {
    const store = draft.forScope(state.scope);
    return { ...store.getSnapshot(), ...store, scope: state.scope };
  },
}));
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: string) => key }) }));
vi.mock("@/features/core/products/queries", () => ({ useListProducts: () => ({ data: [] }) }));

afterEach(() => { clearCounterDrafts(); vi.unstubAllGlobals(); state.scope = "pharmacy-session/main"; });

function renderPanel() {
  const store = prescriptionDraft.forScope(state.scope);
  const { value, pending } = store.getSnapshot();
  return renderToStaticMarkup(<PrescriptionPanel
    open={value.open} editing={value.editing} saving={pending} width={500}
    onResizeStart={() => {}} onClose={store.discard} onSubmit={() => {}}
  />);
}

function fillEntry() {
  const store = prescriptionDraft.forScope(state.scope);
  store.update({
    open: true, doctorName: "QA Recovery Doctor", doctorRegNo: "QA-REG", doctorClinic: "QA Clinic",
    patientName: "QA Interruption Patient", patientPhone: "6999996433", patientAge: "42",
    patientGender: "female", patientAddress: "QA Test Address", scheduleType: "h1",
    prescribedOn: "2026-09-29", refillsAllowed: "2", notes: "QA follow-up", dispenseNow: false,
    items: [emptyPrescriptionItem({ productId: "vitamins", name: "QA Vitamins", qty: 2.5,
      strength: "QA strength", dosage: "QA dosage", batchNumber: "QA-BATCH", substitutedFor: "QA Brand" })],
  });
  return store;
}

describe("prescription interruption recovery", () => {
  it("renders all entered details again after the page is remounted without writing patient data to disk", () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { setItem } });
    const store = fillEntry();
    const before = store.getSnapshot().value;
    const first = renderPanel();
    const remounted = renderPanel();
    expect(remounted).toBe(first);
    for (const text of ["QA Recovery Doctor", "QA-REG", "QA Clinic", "QA Interruption Patient", "6999996433",
      "QA Test Address", "2026-09-29", "QA follow-up", "QA Vitamins", "QA strength", "QA dosage", "QA-BATCH", "QA Brand"]) {
      expect(remounted).toContain(text);
    }
    expect(remounted).toContain('value="2.5"');
    expect(remounted).toContain('<option value="h1" selected="">');
    expect(remounted).not.toContain('type="checkbox" checked=""');
    expect(prescriptionDraft.forScope(state.scope).getSnapshot().value).toEqual(before);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("retains a correction's entry identity and medicines without dispensing it again", () => {
    const original = {
      id: "rx-42", registerNumber: "RX-000042", doctorName: "QA Doctor", patientName: "QA Patient",
      scheduleType: "h", prescribedOnKey: "2026-09-29", refillsAllowed: 3, notes: "Recorded note",
      items: [{ productId: "product-42", name: "QA Medicine", qty: 3, unit: "tablet", dosage: "From the slip" }],
    } as Prescription;
    const store = prescriptionDraft.forScope(state.scope);
    store.update({ ...prescriptionFormDraft(original), open: true });
    store.update((draft) => ({ ...draft, notes: "Corrected note", items: draft.items.map((item) => ({ ...item, qty: 4 })) }));
    expect(renderPanel()).toContain("Correct RX-000042");
    expect(renderPanel()).toContain('value="4"');
    expect(renderPanel()).not.toContain("workflow.register.billAfterRecording");
    expect(store.getSnapshot().value).toMatchObject({ editing: { id: "rx-42" }, dispenseNow: false, notes: "Corrected note" });
    expect(original.items[0].qty).toBe(3);
  });

  it("disables every field and close action while saving, including after remount, and refuses a duplicate", async () => {
    const store = fillEntry();
    let finish!: () => void;
    const pending = store.submit(() => new Promise<void>((resolve) => { finish = resolve; }));
    const html = renderPanel();
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toMatch(/<button disabled=""[^>]*aria-label="Close"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
    expect(html).toContain("Saving…");
    const duplicate = vi.fn();
    await expect(prescriptionDraft.forScope(state.scope).submit(duplicate)).rejects.toThrow();
    store.update({ patientName: "Should not change" });
    store.discard();
    expect(store.getSnapshot().value.patientName).toBe("QA Interruption Patient");
    expect(duplicate).not.toHaveBeenCalled();
    finish(); await pending;
    expect(store.getSnapshot().value).toMatchObject({ open: false, editing: null, patientName: "", notes: "" });
    expect(store.getSnapshot().value.items).toEqual([emptyPrescriptionItem()]);
  });

  it("keeps a refused entry editable for correction and clears it on Cancel", async () => {
    const store = fillEntry();
    await expect(store.submit(async () => { throw Error("Connection unavailable"); })).rejects.toThrow();
    expect(renderPanel()).toContain("QA Interruption Patient");
    expect(renderPanel()).not.toMatch(/<fieldset disabled/);
    store.update({ notes: "Corrected after failure" });
    expect(renderPanel()).toContain("Corrected after failure");
    store.discard();
    store.update({ ...prescriptionFormDraft(), open: true });
    expect(renderPanel()).not.toContain("QA Interruption Patient");
    expect(store.getSnapshot().value.dispenseNow).toBe(true);
  });

  it("isolates patient details between branches and clears them on sign-out", async () => {
    const store = fillEntry();
    let finish!: () => void;
    const pending = store.submit(() => new Promise<void>((resolve) => { finish = resolve; }));
    state.scope = "pharmacy-session/other-branch";
    expect(renderPanel()).not.toContain("QA Interruption Patient");
    clearCounterDrafts();
    state.scope = "next-login/main";
    const next = prescriptionDraft.forScope(state.scope);
    next.update({ patientName: "Next patient", open: true });
    finish(); await pending;
    expect(store.getSnapshot().value.patientName).toBe("");
    expect(renderPanel()).toContain("Next patient");
  });
});

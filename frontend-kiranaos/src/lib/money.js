// src/lib/money.js — formatting helpers
export const fromPaise = (p) => Number(p || 0) / 100;
export const inr = (rupees) => `₹${Number(rupees || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const inrPaise = (paise) => inr(fromPaise(paise));

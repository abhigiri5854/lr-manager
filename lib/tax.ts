// GST maths for tax invoices and freight bills. All amounts in integer paise.

/** "10" → 10000 (qty in thousandths, avoids float drift for numeric quantities). */
function qtyMilli(qty: string): number {
  return Math.round(Number(qty) * 1000);
}

export type InvoiceLineInput = {
  qty: string;
  ratePaise: number;
  discountPaise: number;
  /** 1800 = 18% */
  gstRateBp: number;
};

export type InvoiceLineTax = {
  taxablePaise: number;
  sgstPaise: number;
  cgstPaise: number;
  igstPaise: number;
};

/**
 * Tax is rounded per line (SGST = CGST = half the line tax, each rounded); totals add the rounded
 * line values. With roundOff the grand total goes to the nearest rupee and the difference is its
 * own line. intraState: place of supply = seller state → SGST + CGST, else IGST.
 */
export function computeInvoiceTax(
  lines: InvoiceLineInput[],
  intraState: boolean,
  opts: { roundOff?: boolean } = {},
) {
  const lineTaxes: InvoiceLineTax[] = lines.map((l) => {
    const taxablePaise = Math.round((l.ratePaise * qtyMilli(l.qty)) / 1000) - l.discountPaise;
    const tax = (taxablePaise * l.gstRateBp) / 10000;
    if (intraState) {
      const half = Math.round(tax / 2);
      return { taxablePaise, sgstPaise: half, cgstPaise: half, igstPaise: 0 };
    }
    return { taxablePaise, sgstPaise: 0, cgstPaise: 0, igstPaise: Math.round(tax) };
  });
  const sum = (k: keyof InvoiceLineTax) => lineTaxes.reduce((t, l) => t + l[k], 0);
  const taxablePaise = sum("taxablePaise");
  const sgstPaise = sum("sgstPaise");
  const cgstPaise = sum("cgstPaise");
  const igstPaise = sum("igstPaise");
  const beforeRound = taxablePaise + sgstPaise + cgstPaise + igstPaise;
  const roundOffPaise = opts.roundOff ? Math.round(beforeRound / 100) * 100 - beforeRound : 0;
  return {
    lines: lineTaxes,
    totals: {
      taxablePaise,
      sgstPaise,
      cgstPaise,
      igstPaise,
      roundOffPaise,
      totalPaise: beforeRound + roundOffPaise,
    },
  };
}

/** GST on freight: zero under reverse charge; forward charge splits by state. */
export function computeFreightGst(
  chargesPaise: number,
  gstMode: "reverse_charge" | "forward_charge",
  gstRateBp: number,
  intraState: boolean,
) {
  if (gstMode === "reverse_charge" || gstRateBp === 0) {
    return { sgstPaise: 0, cgstPaise: 0, igstPaise: 0 };
  }
  const tax = (chargesPaise * gstRateBp) / 10000;
  if (intraState) {
    const half = Math.round(tax / 2);
    return { sgstPaise: half, cgstPaise: half, igstPaise: 0 };
  }
  return { sgstPaise: 0, cgstPaise: 0, igstPaise: Math.round(tax) };
}

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
 * Line taxes are shown rounded per line; invoice totals sum the exact (unrounded) taxes and
 * round once, as the design says ("the software rounds once at the total").
 * intraState: place of supply = seller state → SGST + CGST, else IGST.
 */
export function computeInvoiceTax(lines: InvoiceLineInput[], intraState: boolean) {
  let taxable = 0;
  let exactHalf = 0; // SGST (= CGST) before rounding
  let exactIgst = 0;
  const lineTaxes: InvoiceLineTax[] = lines.map((l) => {
    const taxablePaise = Math.round((l.ratePaise * qtyMilli(l.qty)) / 1000) - l.discountPaise;
    const tax = (taxablePaise * l.gstRateBp) / 10000;
    taxable += taxablePaise;
    if (intraState) {
      exactHalf += tax / 2;
      const half = Math.round(tax / 2);
      return { taxablePaise, sgstPaise: half, cgstPaise: half, igstPaise: 0 };
    }
    exactIgst += tax;
    return { taxablePaise, sgstPaise: 0, cgstPaise: 0, igstPaise: Math.round(tax) };
  });
  const sgstPaise = Math.round(exactHalf);
  const igstPaise = Math.round(exactIgst);
  return {
    lines: lineTaxes,
    totals: {
      taxablePaise: taxable,
      sgstPaise,
      cgstPaise: sgstPaise,
      igstPaise,
      roundOffPaise: 0,
      totalPaise: taxable + 2 * sgstPaise + igstPaise,
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

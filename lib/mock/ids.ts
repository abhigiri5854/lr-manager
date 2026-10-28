// Fixed UUIDs for sample data so links between mock records stay stable.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const IDS = {
  company: { acm: id(0x101), rs: id(0x102) },
  user: { owner: id(0x201), staff: id(0x202), driver: id(0x203), accountant: id(0x204) },
  membership: {
    ownerAcm: id(0x211),
    ownerRs: id(0x212),
    staffAcm: id(0x213),
    driverAcm: id(0x214),
    accountantAcm: id(0x215),
  },
  party: {
    ashirvad: id(0x301),
    maaVaishno: id(0x302),
    modernSanitation: id(0x303),
    india1789: id(0x304),
  },
  driver: { d7870: id(0x401), d8873: id(0x402) },
  truck: { br01gn8331: id(0x501), br06gb7374: id(0x502) },
  item: { tank500x4: id(0x601), tank1000x3: id(0x602), tank1000x4: id(0x603) },
  lr: { lr19019: id(0x701), lr19020: id(0x702) },
  lrItem: { a: id(0x711), b: id(0x712), c: id(0x713), d: id(0x714) },
  lrInvoice: { a: id(0x721), b: id(0x722) },
  invoice: { sq2604002116: id(0x801) },
  invoiceLine: { a: id(0x811), b: id(0x812), c: id(0x813) },
} as const;

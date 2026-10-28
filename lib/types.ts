export type Company = {
  id: string;
  name: string;
  city: string;
};

/** An LR that has been delivered but whose POD has not been received. */
export type PodPendingRow = {
  lrId: string;
  lrNo: string;
  /** ISO date */
  deliveredOn: string;
  consignee: string;
  daysSinceDelivery: number;
  /** Penalty accrued so far, in paise (per company POD rules). */
  penaltyPaise: number;
};

-- Hand-written. Optional bank proof (cancelled cheque / passbook photo or PDF) on a truck party.
-- Stored like upi_qr_file: an object path in the private truck-docs bucket. Never required.
-- Deliberately NOT part of the bank_changed_at trigger (uploading proof is not a bank change).
alter table public.truck_parties add column bank_proof_file text;

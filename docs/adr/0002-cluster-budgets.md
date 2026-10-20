# ADR-0002: Budgets per identity cluster
**Context.** Free-tier abuse uses many accounts; per-account limits multiply the free budget by the number of fake accounts.
**Decision.** Union Find over device fingerprint and normalised email; one dollar ceiling per cluster (unpaid $5, paid $50 by default, per tenant overridable).
**Consequences.** A 100-account farm on one device gets one budget (97% of its calls denied in the attack suite). A family sharing one laptop also shares one budget (0% FP at the measured volume of 4 users x 10 calls; heavier shared use would hit the cluster velocity limit).

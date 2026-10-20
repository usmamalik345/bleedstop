# BleedStop eval report

Golden set: `evals/golden/traffic-v1.jsonl` (sha256 `9bf25c5c969fbbd5…`). Positive = DENY or CHALLENGE. Sequential replay, state reset per scenario, memory mode. Benign scenarios have no positives, so precision/recall are n/a there and only FP rate matters; abusive scenarios have no negatives, so only recall matters.

## A original code

| Scenario | Label | N | TP | FP | FN | TN | Precision | Recall | F1 | FP rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| normal_users | benign | 1000 | 0 | 0 | 0 | 1000 | n/a | n/a | n/a | 0.0% |
| shared_household_device | benign | 40 | 0 | 0 | 0 | 40 | n/a | n/a | n/a | 0.0% |
| office_nat_same_ip | benign | 300 | 0 | 0 | 0 | 300 | n/a | n/a | n/a | 0.0% |
| campus_nat_one_subnet | benign | 1000 | 0 | 662 | 0 | 338 | 0.0% | n/a | n/a | 66.2% |
| isp_many_new_users | benign | 600 | 0 | 262 | 0 | 338 | 0.0% | n/a | n/a | 43.7% |
| farm_shared_device | abusive | 2000 | 1662 | 0 | 338 | 0 | 100.0% | 83.1% | 90.8% | n/a |
| token_flood | abusive | 200 | 0 | 0 | 200 | 0 | n/a | 0.0% | n/a | n/a |
| retry_storm | abusive | 1000 | 662 | 0 | 338 | 0 | 100.0% | 66.2% | 79.7% | n/a |
| rotated_same_subnet | abusive | 2000 | 1662 | 0 | 338 | 0 | 100.0% | 83.1% | 90.8% | n/a |
| rotated_residential_proxy_one_asn | abusive | 2000 | 1662 | 0 | 338 | 0 | 100.0% | 83.1% | 90.8% | n/a |
| rotated_fully | abusive | 2000 | 0 | 0 | 2000 | 0 | n/a | 0.0% | n/a | n/a |
| **overall** | | 12140 | 5648 | 924 | 3552 | 2016 | 85.9% | 61.4% | 71.6% | 31.4% |

## B current, ASN union on (CLUSTER_ON_ASN=1)

| Scenario | Label | N | TP | FP | FN | TN | Precision | Recall | F1 | FP rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| normal_users | benign | 1000 | 0 | 0 | 0 | 1000 | n/a | n/a | n/a | 0.0% |
| shared_household_device | benign | 40 | 0 | 0 | 0 | 40 | n/a | n/a | n/a | 0.0% |
| office_nat_same_ip | benign | 300 | 0 | 240 | 0 | 60 | 0.0% | n/a | n/a | 80.0% |
| campus_nat_one_subnet | benign | 1000 | 0 | 940 | 0 | 60 | 0.0% | n/a | n/a | 94.0% |
| isp_many_new_users | benign | 600 | 0 | 540 | 0 | 60 | 0.0% | n/a | n/a | 90.0% |
| farm_shared_device | abusive | 2000 | 1940 | 0 | 60 | 0 | 100.0% | 97.0% | 98.5% | n/a |
| token_flood | abusive | 200 | 200 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% | n/a |
| retry_storm | abusive | 1000 | 940 | 0 | 60 | 0 | 100.0% | 94.0% | 96.9% | n/a |
| rotated_same_subnet | abusive | 2000 | 1940 | 0 | 60 | 0 | 100.0% | 97.0% | 98.5% | n/a |
| rotated_residential_proxy_one_asn | abusive | 2000 | 1940 | 0 | 60 | 0 | 100.0% | 97.0% | 98.5% | n/a |
| rotated_fully | abusive | 2000 | 0 | 0 | 2000 | 0 | n/a | 0.0% | n/a | n/a |
| **overall** | | 12140 | 6960 | 1720 | 2240 | 1220 | 80.2% | 75.7% | 77.9% | 58.5% |

## C current default

| Scenario | Label | N | TP | FP | FN | TN | Precision | Recall | F1 | FP rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| normal_users | benign | 1000 | 0 | 0 | 0 | 1000 | n/a | n/a | n/a | 0.0% |
| shared_household_device | benign | 40 | 0 | 0 | 0 | 40 | n/a | n/a | n/a | 0.0% |
| office_nat_same_ip | benign | 300 | 0 | 0 | 0 | 300 | n/a | n/a | n/a | 0.0% |
| campus_nat_one_subnet | benign | 1000 | 0 | 0 | 0 | 1000 | n/a | n/a | n/a | 0.0% |
| isp_many_new_users | benign | 600 | 0 | 0 | 0 | 600 | n/a | n/a | n/a | 0.0% |
| farm_shared_device | abusive | 2000 | 1940 | 0 | 60 | 0 | 100.0% | 97.0% | 98.5% | n/a |
| token_flood | abusive | 200 | 200 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% | n/a |
| retry_storm | abusive | 1000 | 940 | 0 | 60 | 0 | 100.0% | 94.0% | 96.9% | n/a |
| rotated_same_subnet | abusive | 2000 | 1334 | 0 | 666 | 0 | 100.0% | 66.7% | 80.0% | n/a |
| rotated_residential_proxy_one_asn | abusive | 2000 | 0 | 0 | 2000 | 0 | n/a | 0.0% | n/a | n/a |
| rotated_fully | abusive | 2000 | 0 | 0 | 2000 | 0 | n/a | 0.0% | n/a | n/a |
| **overall** | | 12140 | 4414 | 0 | 4786 | 2940 | 100.0% | 48.0% | 64.8% | 0.0% |

## D current, ASN spread enforce (ASN_SPREAD_MODE=enforce)

| Scenario | Label | N | TP | FP | FN | TN | Precision | Recall | F1 | FP rate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| normal_users | benign | 1000 | 0 | 0 | 0 | 1000 | n/a | n/a | n/a | 0.0% |
| shared_household_device | benign | 40 | 0 | 0 | 0 | 40 | n/a | n/a | n/a | 0.0% |
| office_nat_same_ip | benign | 300 | 0 | 0 | 0 | 300 | n/a | n/a | n/a | 0.0% |
| campus_nat_one_subnet | benign | 1000 | 0 | 0 | 0 | 1000 | n/a | n/a | n/a | 0.0% |
| isp_many_new_users | benign | 600 | 0 | 400 | 0 | 200 | 0.0% | n/a | n/a | 66.7% |
| farm_shared_device | abusive | 2000 | 1940 | 0 | 60 | 0 | 100.0% | 97.0% | 98.5% | n/a |
| token_flood | abusive | 200 | 200 | 0 | 0 | 0 | 100.0% | 100.0% | 100.0% | n/a |
| retry_storm | abusive | 1000 | 940 | 0 | 60 | 0 | 100.0% | 94.0% | 96.9% | n/a |
| rotated_same_subnet | abusive | 2000 | 1334 | 0 | 666 | 0 | 100.0% | 66.7% | 80.0% | n/a |
| rotated_residential_proxy_one_asn | abusive | 2000 | 1600 | 0 | 400 | 0 | 100.0% | 80.0% | 88.9% | n/a |
| rotated_fully | abusive | 2000 | 0 | 0 | 2000 | 0 | n/a | 0.0% | n/a | n/a |
| **overall** | | 12140 | 6014 | 400 | 3186 | 2540 | 93.8% | 65.4% | 77.0% | 13.6% |

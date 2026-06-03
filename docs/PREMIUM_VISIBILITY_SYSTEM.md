# DZN Premium Visibility System

Premium visibility is a public discovery layer for DZN server listings. It helps higher-tier plans appear in discovery surfaces while keeping competitive leaderboards fair.

## What It Affects

- public server discovery ordering
- featured server candidate groups
- recommended server candidate groups
- server spotlight eligibility
- premium public visual treatment

## What It Does Not Affect

Visibility never changes competitive stats or rank calculations:

- kills
- deaths
- K/D
- longest kill
- survival records
- crown winners
- tournament scores
- ADM sync or imported statistics

Competitive leaderboard calculations remain based on gameplay/stat data only.

## Plan Rules

| Plan | Visibility Weight | Discovery Behaviour | Spotlight |
| --- | ---: | --- | --- |
| Starter | 1 | Standard listing | Not eligible |
| Pro | 2 | Enhanced discovery and featured rotation eligibility | Not eligible |
| Premium | 4 | Premium discovery priority, featured priority, premium visuals | Eligible |

Legacy `network` and `partner` plan keys normalize to Premium for old rows and subscriptions. They must not appear as public plans.

## Discovery Score

The discovery score is an explainable public placement score. It can use:

- plan visibility weight
- recent activity
- server reputation
- public badge count
- public profile completeness
- visual loadout completeness
- active status

It is separate from competitive score. Discovery score is safe for browsing, recommendation, featured, and spotlight placement only.

## Spotlight Eligibility

Premium servers are eligible for spotlight placement when public listing data is available. Starter and Pro servers remain professional in standard discovery and featured rotation, but they are not spotlight eligible.

## Fairness

Paid plans can improve visibility and presentation. They cannot buy better leaderboard rank, crowns, tournament wins, ADM stats, or server-vs-server scores.

## Why Competitive Leaderboards Remain Fair

Competitive leaderboards continue to use gameplay/stat ranking inputs only. Premium visibility creates discovery and presentation placement, but it does not rewrite competitive scores or reorder ranked stat tables.

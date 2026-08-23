# DZN Pro Visibility System

Pro visibility is a public discovery layer for DZN server listings. It helps the full-access plan appear in discovery surfaces while keeping competitive leaderboards fair.

## What It Affects

- public server discovery ordering
- featured server candidate groups
- recommended server candidate groups
- server spotlight eligibility
- premium-style public visual treatment

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
| Pro | 4 | Full discovery priority, featured priority, premium-style visuals | Eligible |

Legacy `premium`, `network`, and `partner` plan keys normalize to effective Pro for old rows and subscriptions. They must not appear as public plans.

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

Pro servers are eligible for spotlight placement when public listing data is available. Starter servers remain in standard discovery and are not spotlight eligible.

## Fairness

Paid plans can improve visibility and presentation. They cannot buy better leaderboard rank, crowns, tournament wins, ADM stats, or server-vs-server scores.

## Why Competitive Leaderboards Remain Fair

Competitive leaderboards continue to use gameplay/stat ranking inputs only. Pro visibility creates discovery and presentation placement, but it does not rewrite competitive scores or reorder ranked stat tables.

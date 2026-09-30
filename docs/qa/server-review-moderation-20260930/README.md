# Server Review Moderation QA

- Route: `/owner/reviews`
- Widths: 390, 900, and 1440 pixels
- Data: intercepted deterministic moderation fixture; no production writes
- Assertions: no horizontal overflow, reported review visible, approve and hide actions visible, no page errors
- Database: migration `0079` applied separately to an isolated local D1 database with schema and foreign-key verification

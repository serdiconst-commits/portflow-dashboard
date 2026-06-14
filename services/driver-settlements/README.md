# Portflow Driver Settlements

This module is the backend foundation for the rebuilt Portflow driver-settlement workflow. It is implemented inside the current Portflow JavaScript/SQLite server so it can run safely with the live system today. The schema and service names mirror the future PostgreSQL/ORM design, which keeps a later migration straightforward.

## What It Does

- Creates weekly settlements by driver.
- Auto-adds completed loads by appointment date.
- Calculates load pay from each driver's configured pay structure.
- Supports extra loads or manual payments outside the selected period.
- Stores deductions and reimbursements in a real database table.
- Recalculates gross pay, adjustments, and net pay after each change.
- Keeps an audit log of settlement changes.
- Generates a JSON driver statement.

## Database Changes

The existing `drivers` table now supports pay configuration:

- `payType`: `per_load`, `per_mile`, `percentage`, `hourly`, `mixed`, or `hybrid`
- `payPerMileRate`
- `payPerLoadRate`
- `payPercentageRate`
- `payHourlyRate`
- `dispatchPercentage`
- `driverSplitPercentage`
- `weeklyInsurance`
- `weeklyOccupationalAccident`

The existing `loads` table now supports payroll data:

- `miles`
- `tonnage`
- `movesCount`
- `hoursWorked`

New tables:

- `settlements`
- `settlement_loads`
- `deductions`
- `settlement_audit_logs`

## API Routes

All routes require login and are mounted under:

```text
/api/driver-settlements
```

Allowed roles:

- `admin`
- `manager`
- `dispatcher`
- `payroll`

## Create Weekly Settlement

Auto-adds completed loads for the driver using appointment dates.

```powershell
curl.exe -X POST http://localhost:4000/api/driver-settlements `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_TOKEN" `
  -d "{ \"driverId\":\"DRV-001\", \"periodStart\":\"2026-06-08\", \"periodEnd\":\"2026-06-14\" }"
```

## List Settlements

```powershell
curl.exe http://localhost:4000/api/driver-settlements `
  -H "Authorization: Bearer YOUR_TOKEN"
```

Optional filters:

```text
?driverId=DRV-001&periodStart=2026-06-01&periodEnd=2026-06-30
```

## View Settlement

```powershell
curl.exe http://localhost:4000/api/driver-settlements/SETTLEMENT_ID `
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Add Extra Load Or Payment

Use this when payroll needs to add a load from another period or a manual adjustment payment.

```powershell
curl.exe -X POST http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/loads `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_TOKEN" `
  -d "{ \"loadId\":\"LD-0007\", \"payAmount\":150, \"description\":\"Late add from previous week\" }"
```

For a manual payment not tied to a load:

```powershell
curl.exe -X POST http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/loads `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_TOKEN" `
  -d "{ \"payAmount\":75, \"description\":\"Safety bonus\" }"
```

## Remove Extra Load Or Payment

```powershell
curl.exe -X DELETE http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/loads/SETTLEMENT_LOAD_ID `
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Add Deduction Or Reimbursement

Positive amounts increase pay. Negative amounts reduce pay.

```powershell
curl.exe -X POST http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/deductions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_TOKEN" `
  -d "{ \"description\":\"Parking\", \"amount\":-37.50 }"
```

```powershell
curl.exe -X POST http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/deductions `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer YOUR_TOKEN" `
  -d "{ \"description\":\"Scale ticket reimbursement\", \"amount\":18.00 }"
```

## Remove Deduction

```powershell
curl.exe -X DELETE http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/deductions/DEDUCTION_ID `
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Recalculate

```powershell
curl.exe -X POST http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/recalculate `
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Generate Statement JSON

```powershell
curl.exe http://localhost:4000/api/driver-settlements/SETTLEMENT_ID/statement `
  -H "Authorization: Bearer YOUR_TOKEN"
```

The statement includes:

- Driver details
- Period
- Gross earnings per load
- Extra loads/manual payments
- Deductions and reimbursements
- Net pay
- Audit trail

## Next Integration Step

The old settlement UI should be connected to these endpoints after local testing. Until that is complete, the old UI remains in place to avoid interrupting live payroll.

Future efficiency improvements:

- Export settlements to QuickBooks CSV/IIF.
- Lock approved settlements.
- Add PDF statement generation.
- Pull fuel transactions into deductions automatically.
- Post approved settlements to accounting.

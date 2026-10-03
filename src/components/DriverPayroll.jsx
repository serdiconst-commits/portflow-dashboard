import PayrollRouteFields from "./PayrollRouteFields.jsx";
import { useEffect, useRef, useState } from "react";
import "./DriverPayroll.css";
const money = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value) || 0,
  );
const statusOf = (value) =>
  /^(complete|completed|finalized)$/i.test(value || "")
    ? "Finalized"
    : value || "Draft";
const today = new Date();
const date = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const initialStart = new Date(
  today.getFullYear(),
  today.getMonth(),
  today.getDate() - ((today.getDay() + 6) % 7),
);

export default function DriverPayroll({
  apiBase,
  token,
  drivers = [],
  loads = [],
  locations = [],
}) {
  const [start, setStart] = useState(date(initialStart)),
    [end, setEnd] = useState(
      date(
        new Date(
          initialStart.getFullYear(),
          initialStart.getMonth(),
          initialStart.getDate() + 6,
        ),
      ),
    );
  const [rows, setRows] = useState([]),
    [active, setActive] = useState(null),
    [filter, setFilter] = useState("All"),
    [search, setSearch] = useState(""),
    [tab, setTab] = useState("Movements");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [driverId, setDriverId] = useState("");
  const [editingAdjustment, setEditingAdjustment] = useState(null),
    [rules, setRules] = useState([]);
  const [moveQuery, setMoveQuery] = useState(""),
    [moveCandidates, setMoveCandidates] = useState([]),
    [addingMovement, setAddingMovement] = useState(null),
    [editingLine, setEditingLine] = useState(null),
    [paymentOpen, setPaymentOpen] = useState(false),
    [correctionOpen, setCorrectionOpen] = useState(false),
    [editingRule, setEditingRule] = useState(null);
  const [documentLoad, setDocumentLoad] = useState(null),
    [documentUrl, setDocumentUrl] = useState("");
  useEffect(
    () => () => {
      if (documentUrl) URL.revokeObjectURL(documentUrl);
    },
    [documentUrl],
  );
  const requestId = useRef(0),
    dialog = useRef(null),
    running = useRef(false);
  async function request(path = "", options = {}) {
    const response = await fetch(`${apiBase}/api/driver-settlements${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Payroll request failed.");
    return data;
  }
  async function reload() {
    const id = ++requestId.current;
    const result = await request(
      `?${new URLSearchParams({ periodStart: start, periodEnd: end })}`,
    );
    if (id === requestId.current) setRows(result);
  }
  useEffect(() => {
    setActive(null);
    setRows([]);
    setError("");
    if (!start || !end || start > end) {
      setError("Choose a valid pay period.");
      return;
    }
    reload().catch((e) => setError(e.message));
    return () => {
      requestId.current++;
    };
  }, [start, end, token]);
  useEffect(() => {
    if (active && !dialog.current?.open) dialog.current?.showModal();
    if (!active && dialog.current?.open) dialog.current.close();
  }, [active]);
  useEffect(() => { setAddingMovement(null); }, [active?.id]);
  const totals = rows.reduce(
    (sum, row) => ({
      gross: sum.gross + Number(row.grossPay || 0),
      net: sum.net + Number(row.netPay || 0),
    }),
    { gross: 0, net: 0 },
  );
  const statement = active?.statement,
    status = statusOf(active?.status),
    editable = status === "Draft";
  const adjustments = [
    ...(statement?.deductions || []),
    ...(statement?.netDeductions || []),
  ];
  async function run(task) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(e.message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function open(id) {
    await run(async () => {
      const result = await request(`/${encodeURIComponent(id)}`);
      setActive(result);
      setNote(result.notes || "");
      setTab("Movements");
      setEditingLine(null);
      setMoveCandidates([]);
      setAddingMovement(null);
      setPaymentOpen(false);
      setCorrectionOpen(false);
      setEditingRule(null);
      setEditingAdjustment(null);
      setRules(await request(`/rules/${encodeURIComponent(result.driverId)}`));
    });
  }
  async function mutate(suffix, method, body) {
    const result = await request(`/${encodeURIComponent(active.id)}${suffix}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    setActive(result);
    setNote(result.notes || "");
    await reload();
  }
  async function transition(action) {
    let reason = "";
    if (action === "unreview" || action === "reopen") {
      reason = window
        .prompt("Reason for returning this settlement to Draft:")
        ?.trim();
      if (!reason) return;
    } else if (
      !window.confirm(
        `${action === "review" ? "Review" : "Finalize and lock"} ${statement.driver.name}?\n${statement.totals.loadCount} movements · Net ${money(statement.totals.netPay)}\nThis does not send money or email.`,
      )
    )
      return;
    await run(() => mutate("/transition", "POST", { action, reason }));
  }
  async function download(path = "/pdf") {
    await run(async () => {
      const response = await fetch(
        `${apiBase}/api/driver-settlements/${encodeURIComponent(active.id)}${path}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error("Could not download statement.");
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `Settlement-${active.driverId}-${active.periodStart}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const visible = rows.filter(
    (r) =>
      (filter === "All" || statusOf(r.status) === filter) &&
      `${r.driverName} ${r.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="payroll-workspace">
      <div className="payroll-heading">
        <div>
          <small>ACCOUNTS PAYABLE</small>
          <h2>Driver Payroll</h2>
          <p>Every movement. One settlement. One source for your totals.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className="payroll-error">
          {error}
        </p>
      )}
      <div className="payroll-stats">
        {[
          ["Settlements", rows.length],
          ["Movement pay", money(totals.gross)],
          ["Net adjustments", money(totals.net - totals.gross)],
          ["Net pay", money(totals.net)],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="payroll-card">
        <div className="payroll-toolbar">
          <label>
            From
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Prepare for driver
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose driver</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name || d.id}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-btn"
            disabled={busy || !driverId || !start || !end || start > end}
            onClick={() =>
              run(async () => {
                const result = await request("", {
                  method: "POST",
                  body: JSON.stringify({
                    driverId,
                    periodStart: start,
                    periodEnd: end,
                  }),
                });
                setActive(result);
                setNote(result.notes || "");
                setTab("Movements");
                setEditingLine(null);
                setMoveCandidates([]);
                setPaymentOpen(false);
                setCorrectionOpen(false);
                setEditingRule(null);
                setEditingAdjustment(null);
                setRules(
                  await request(
                    `/rules/${encodeURIComponent(result.driverId)}`,
                  ),
                );
                await reload();
              })
            }
          >
            Prepare payroll
          </button>
          <input
            type="search"
            aria-label="Search payroll"
            placeholder="Search driver or settlement #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="payroll-tabs">
          {["All", "Draft", "Reviewed", "Finalized", "Paid"].map((s) => (
            <button
              key={s}
              className={filter === s ? "active" : ""}
              onClick={() => setFilter(s)}
            >
              {s}{" "}
              <small>
                {
                  rows.filter((r) => s === "All" || statusOf(r.status) === s)
                    .length
                }
              </small>
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Settlement # / Period</th>
                <th>Moves</th>
                <th>Movement pay</th>
                <th>Net adjustments</th>
                <th>Net pay</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.driverName || row.driverId}</strong>
                  </td>
                  <td>
                    <span title={row.id}>
                      #{row.id.slice(0, 8).toUpperCase()}
                    </span>
                    {row.correctionOf && (
                      <small>
                        Correction of #
                        {row.correctionOf.slice(0, 8).toUpperCase()}
                      </small>
                    )}
                    <small>
                      {row.periodStart} — {row.periodEnd}
                    </small>
                  </td>
                  <td>{row.loadCount}</td>
                  <td>{money(row.grossPay)}</td>
                  <td>{money(Number(row.netPay) - Number(row.grossPay))}</td>
                  <td>
                    <strong>{money(row.netPay)}</strong>
                  </td>
                  <td>
                    <span className="payroll-status">
                      {statusOf(row.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => open(row.id)}
                    >
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan="8">
                    No settlements in this period. Choose a driver to prepare a
                    draft from completed movements.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <dialog
        className="payroll-dialog"
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setActive(null);
        }}
        onClose={() => setActive(null)}
      >
        {statement && (
          <>
            <header>
              <div>
                <small>DRIVER SETTLEMENT · {status}</small>
                <h2>{statement.driver.name}</h2>
                <p>
                  #{active.id.slice(0, 8).toUpperCase()} · {active.periodStart}{" "}
                  — {active.periodEnd} · Version {active.version}
                </p>
                {active.emailedAt && (
                  <small>Last emailed: {active.emailedAt}</small>
                )}
              </div>
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => setActive(null)}
                aria-label="Close payroll detail"
              >
                Close
              </button>
            </header>
            {error && (
              <p role="alert" className="payroll-error">
                {error}
              </p>
            )}
            <div className="payroll-stats">
              {[
                ["Movement pay", statement.totals.grossPay],
                [
                  "Additions",
                  adjustments
                    .filter((a) => a.amount > 0)
                    .reduce((s, a) => s + a.amount, 0),
                ],
                [
                  "Deductions",
                  adjustments
                    .filter((a) => a.amount < 0)
                    .reduce((s, a) => s - a.amount, 0),
                ],
                ["Net pay", statement.totals.netPay],
              ].map(([l, v]) => (
                <div key={l}>
                  <small>{l}</small>
                  <strong>{money(v)}</strong>
                </div>
              ))}
            </div>
            {!editable && (
              <p className="payroll-notice">
                Amounts are locked.{" "}
                {status === "Reviewed"
                  ? "Return to Draft with a reason before correcting them."
                  : "Finalized does not mean a bank payment has been sent."}
              </p>
            )}
            <div className="payroll-tabs">
              {[
                "Movements",
                "Add movement",
                "Documents",
                "Adjustments",
                "Saved adjustments",
                "Notes",
                "History",
              ].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="payroll-detail">
              {status === "Finalized" && statement.totals.netPay <= 0 && (
                <p className="payroll-notice">
                  No positive payment is due. Credits are not automatically
                  carried forward. Review any deduction to apply in the next
                  period before recording a payment.
                </p>
              )}
              {active.correction && (
                <p className="payroll-notice">
                  Supplemental correction of #
                  {active.correction.parentId.slice(0, 8).toUpperCase()}. Add
                  only omitted movements or the difference owed. Previously paid
                  amounts and recurring deductions are not copied.
                </p>
              )}
              {editingLine && editable && (
                <form
                  className="payroll-toolbar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      await mutate(
                        `/loads/${encodeURIComponent(editingLine.settlementLoadId)}`,
                        "PUT",
                        {
                          payAmount: Number(f.get("pay")),
                          description: String(f.get("reason")).trim(),
                          ...(!editingLine.loadId && !editingLine.moveId ? { containerNumber: String(f.get("containerNumber") || "").trim() } : {}),
                        },
                      );
                      setEditingLine(null);
                    });
                  }}
                >
                  <strong>
                    {editingLine.loadId || editingLine.description}
                  </strong>
                  <label>
                    New pay
                    <input
                      name="pay"
                      type="number"
                      step="0.01"
                      required
                      defaultValue={editingLine.payAmount}
                    />
                  </label>
                  {!editingLine.loadId && !editingLine.moveId && <label>
                    Container #
                    <input name="containerNumber" maxLength={30} defaultValue={editingLine.containerNumber || ""} />
                  </label>}
                  <label>
                    Reason
                    <input name="reason" required />
                  </label>
                  <button disabled={busy} className="primary-btn">
                    Save pay
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setEditingLine(null)}
                  >
                    Cancel
                  </button>
                </form>
              )}
              {tab === "Add movement" && (
                <>
                  {editable ? (
                    <>
                      <form
                        className="payroll-toolbar"
                        onSubmit={(e) => {
                          e.preventDefault();
                          run(async () =>
                            setMoveCandidates(
                              await request(
                                `/${encodeURIComponent(active.id)}/candidates?q=${encodeURIComponent(moveQuery)}`,
                              ),
                            ),
                          );
                        }}
                      >
                        <label>
                          Load # or container · all dates
                          <input
                            value={moveQuery}
                            onChange={(e) => setMoveQuery(e.target.value)}
                          />
                        </label>
                        <button className="primary-btn" disabled={busy}>
                          Search completed movements
                        </button>
                      </form>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Load / Container</th>
                              <th>Movement / Completed</th>
                              <th>Route</th>
                              <th>Pay</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {moveCandidates.map((m) => (
                              <tr key={m.moveId}>
                                <td>
                                  {m.loadId}
                                  <small>{m.containerNumber}</small>
                                </td>
                                <td>
                                  {m.moveType}
                                  <small>{m.completedAt}</small>
                                </td>
                                <td>
                                  {m.origin} → {m.destination}
                                </td>
                                <td>{money(m.driverRate)}</td>
                                <td>
                                  <button
                                    disabled={busy || !!m.includedIn}
                                    className="secondary-btn"
                                    onClick={() => setAddingMovement(m)}
                                  >
                                    {m.includedIn
                                      ? "Already included"
                                      : "Add movement"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {addingMovement && (
                        <form key={addingMovement.moveId} className="payroll-route-form" onSubmit={(e) => {
                          e.preventDefault();
                          const fields = new FormData(e.currentTarget);
                          run(async () => {
                            await mutate("/loads", "POST", {
                              moveId: addingMovement.moveId,
                              description: String(fields.get("reason")).trim(),
                              pickupLocation: String(fields.get("pickupLocation")).trim(),
                              deliveryLocation: String(fields.get("deliveryLocation")).trim(),
                            });
                            setAddingMovement(null);
                            setMoveCandidates([]);
                            setTab("Movements");
                          });
                        }}>
                          <h4>Add {addingMovement.loadId} · {String(addingMovement.moveType || "Movement").replaceAll("_", " ")} · {money(addingMovement.driverRate)}</h4>
                          <PayrollRouteFields locations={locations} pickup={addingMovement.origin} delivery={addingMovement.destination} />
                          <label>Reason for adding this movement<input name="reason" required /></label>
                          <div className="payroll-toolbar">
                            <button className="primary-btn" disabled={busy}>Save movement</button>
                            <button type="button" className="secondary-btn" disabled={busy} onClick={() => setAddingMovement(null)}>Cancel</button>
                          </div>
                        </form>
                      )}
                      <details>
                        <summary>
                          Manual payment / correction difference
                        </summary>
                        <p>
                          For an amount with no completed movement to select.
                          Include the Load # and explanation when applicable.
                          This does not mark a load as paid.
                        </p>
                        <form
                          className="payroll-toolbar"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget),
                              pay = Number(f.get("pay"));
                            if (
                              !window.confirm(
                                `Add a manual payment of ${money(pay)}?`,
                              )
                            )
                              return;
                            run(async () => {
                              await mutate("/loads", "POST", {
                                payAmount: pay,
                                description: String(f.get("reason")).trim(),
                                containerNumber: String(f.get("containerNumber") || "").trim(),
                                pickupLocation: String(f.get("pickupLocation")).trim(),
                                deliveryLocation: String(f.get("deliveryLocation")).trim(),
                              });
                              setTab("Movements");
                            });
                          }}
                        >
                          <label>
                            Amount ($)
                            <input
                              name="pay"
                              required
                              type="number"
                              step="0.01"
                            />
                          </label>
                          <label>
                            Reason / Load #<input name="reason" required />
                          </label>
                          <label>
                            Container #<input name="containerNumber" maxLength={30} placeholder="MRKU1234567" />
                          </label>
                          <PayrollRouteFields locations={locations} />
                          <button disabled={busy} className="primary-btn">
                            Add manual payment
                          </button>
                        </form>
                      </details>
                    </>
                  ) : (
                    <p>
                      Return to Draft or create a correction before adding
                      payments.
                    </p>
                  )}
                </>
              )}
              {correctionOpen && status === "Paid" && (
                <form
                  className="payroll-toolbar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(async () => {
                      await mutate(
                        "/correction",
                        "POST",
                        Object.fromEntries(f),
                      );
                      setCorrectionOpen(false);
                      setTab("Add movement");
                      setMoveCandidates([]);
                      setEditingLine(null);
                    });
                  }}
                >
                  <label>
                    Correction period start
                    <input
                      name="periodStart"
                      type="date"
                      required
                      defaultValue={active.periodStart}
                    />
                  </label>
                  <label>
                    Correction period end
                    <input
                      name="periodEnd"
                      type="date"
                      required
                      defaultValue={active.periodEnd}
                    />
                  </label>
                  {!editingLine.loadId && !editingLine.moveId && <label>
                    Container #
                    <input name="containerNumber" maxLength={30} defaultValue={editingLine.containerNumber || ""} />
                  </label>}
                  <label>
                    Reason
                    <input name="reason" required />
                  </label>
                  <button className="primary-btn" disabled={busy}>
                    Create supplemental draft
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setCorrectionOpen(false)}
                  >
                    Cancel
                  </button>
                </form>
              )}
              {paymentOpen && status === "Finalized" && (
                <form
                  className="payroll-toolbar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    if (
                      !window.confirm(
                        `Record ${money(statement.totals.netPay)} as paid? This records a payment already made; it does not transfer money.`,
                      )
                    )
                      return;
                    run(async () => {
                      await mutate("/payment", "POST", Object.fromEntries(f));
                      setPaymentOpen(false);
                    });
                  }}
                >
                  <label>
                    Payment date
                    <input
                      name="paidOn"
                      type="date"
                      required
                      defaultValue={date(new Date())}
                    />
                  </label>
                  <label>
                    Method
                    <select name="method">
                      <option>ACH</option>
                      <option>Check</option>
                      <option>Cash</option>
                      <option>Other</option>
                    </select>
                  </label>
                  <label>
                    Reference
                    <input name="reference" required />
                  </label>
                  <button className="primary-btn" disabled={busy}>
                    Confirm payment record
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setPaymentOpen(false)}
                  >
                    Cancel
                  </button>
                </form>
              )}

              {tab === "Movements" && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Load # / Container</th>
                        <th>Movement / Date</th>
                        <th>Route</th>
                        <th>Pay</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.loads.map((line) => (
                        <tr key={line.settlementLoadId}>
                          <td>
                            <strong>{line.loadId || line.description}</strong>
                            <small>Container #: {line.containerNumber || "—"}</small>
                          </td>
                          <td>
                            {line.moveType?.replaceAll("_", " ") || "Load"}
                            <small>
                              {line.completedAt || line.appointmentTime}
                            </small>
                          </td>
                          <td>
                            {line.moveOrigin || "—"} →{" "}
                            {line.moveDestination || "—"}
                          </td>
                          <td>
                            {money(line.payAmount)}
                            {editable && (
                              <>
                                <button
                                  disabled={busy}
                                  className="secondary-btn"
                                  onClick={() => setEditingLine(line)}
                                >
                                  Edit pay
                                </button>
                                <button
                                  disabled={busy}
                                  className="secondary-btn"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove ${line.loadId || line.description} (${money(line.payAmount)}) from this period?`,
                                      )
                                    )
                                      run(() =>
                                        mutate(
                                          `/loads/${encodeURIComponent(line.settlementLoadId)}`,
                                          "DELETE",
                                        ),
                                      );
                                  }}
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </td>
                          <td>
                            {line.loadId && (
                              <button
                                className="secondary-btn"
                                onClick={() => {
                                  setDocumentLoad(
                                    loads.find((l) => l.id === line.loadId) || {
                                      id: line.loadId,
                                    },
                                  );
                                  setDocumentUrl("");
                                  setTab("Documents");
                                }}
                              >
                                Load & documents
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!statement.loads.length && (
                        <tr>
                          <td colSpan="5">
                            No completed movements in this settlement.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {tab === "Adjustments" && (
                <>
                  {editable && (
                    <form
                      key={
                        editingAdjustment?.id ||
                        editingAdjustment?.savedRuleId ||
                        "new"
                      }
                      className="payroll-toolbar"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const f = new FormData(form),
                          value = Number(f.get("value")),
                          description = String(f.get("description")).trim();
                        if (
                          !description ||
                          !Number.isFinite(value) ||
                          value <= 0
                        )
                          return;
                        run(async () => {
                          await mutate(
                            editingAdjustment?.id
                              ? `/deductions/${encodeURIComponent(editingAdjustment.id)}`
                              : "/deductions",
                            editingAdjustment?.id ? "PUT" : "POST",
                            {
                              description,
                              kind: f.get("kind"),
                              basis: f.get("basis"),
                              value,
                              repeat: f.get("repeat") === "on",
                              ruleId: editingAdjustment?.savedRuleId,
                              stage: "gross_adjustment",
                            },
                          );
                          setEditingAdjustment(null);
                          setRules(
                            await request(
                              `/rules/${encodeURIComponent(active.driverId)}`,
                            ),
                          );
                          form.reset();
                        });
                      }}
                    >
                      <label>
                        Action
                        <select
                          name="kind"
                          defaultValue={
                            editingAdjustment?.calculation?.kind ||
                            (editingAdjustment?.amount < 0 ? "subtract" : "add")
                          }
                        >
                          <option value="add">Add (+)</option>
                          <option value="subtract">Subtract (−)</option>
                        </select>
                      </label>
                      <label>
                        Description
                        <input
                          name="description"
                          required
                          maxLength={160}
                          defaultValue={editingAdjustment?.description || ""}
                        />
                      </label>
                      <label>
                        Calculate as
                        <select
                          name="basis"
                          defaultValue={
                            editingAdjustment?.calculation?.basis || "fixed"
                          }
                        >
                          <option value="fixed">Fixed amount ($)</option>
                          <option value="percent">% of movement pay</option>
                        </select>
                      </label>
                      <label>
                        Value
                        <input
                          name="value"
                          required
                          type="number"
                          min="0.01"
                          step="0.01"
                          defaultValue={
                            editingAdjustment?.calculation?.value ??
                            (editingAdjustment
                              ? Math.abs(editingAdjustment.amount)
                              : "")
                          }
                        />
                      </label>
                      <label>
                        <input name="repeat" type="checkbox" />
                        Save in saved adjustments for later selection
                      </label>
                      <button className="primary-btn" disabled={busy}>
                        {editingAdjustment?.id
                          ? "Save changes"
                          : "Add to this period"}
                      </button>
                      {editingAdjustment && (
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setEditingAdjustment(null)}
                        >
                          Cancel edit
                        </button>
                      )}
                    </form>
                  )}
                  <p>
                    Percentages use movement pay (
                    {money(statement.totals.grossPay)}) before adjustments.
                    Amounts apply only to this period. Saving the option makes
                    it available to select later; it never applies
                    automatically.
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Calculation</th>
                        <th>Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {adjustments.map((a) => (
                        <tr key={a.id}>
                          <td>
                            {a.description}
                            {a.calculation?.ruleId && (
                              <small>Selected from saved adjustments</small>
                            )}
                          </td>
                          <td>
                            {a.amount < 0 ? "Subtract" : "Add"} ·{" "}
                            {a.calculation?.basis === "percent"
                              ? `${a.calculation.value}% of movement pay`
                              : "Fixed amount"}
                          </td>
                          <td>{money(a.amount)}</td>
                          <td>
                            {editable && (
                              <>
                                <button
                                  disabled={busy}
                                  className="secondary-btn"
                                  onClick={() => setEditingAdjustment(a)}
                                >
                                  Edit
                                </button>
                                <button
                                  disabled={busy}
                                  className="secondary-btn"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove ${a.description} (${money(a.amount)}) from this period only?`,
                                      )
                                    )
                                      run(() =>
                                        mutate(
                                          `/deductions/${encodeURIComponent(a.id)}`,
                                          "DELETE",
                                        ),
                                      );
                                  }}
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>
                    Net pay = movement pay + additions − deductions. All totals
                    are calculated by the server.
                  </p>
                </>
              )}
              {tab === "Saved adjustments" && (
                <>
                  <h3>Saved adjustments</h3>
                  {editingRule && (
                    <form
                      className="payroll-toolbar"
                      key={editingRule.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        if (
                          !window.confirm(
                            "Update the saved option? Adjustments already added to payroll periods will not change.",
                          )
                        )
                          return;
                        run(async () => {
                          await request(
                            `/rules/${encodeURIComponent(editingRule.id)}`,
                            {
                              method: "PUT",
                              body: JSON.stringify({
                                description: f.get("description"),
                                kind: f.get("kind"),
                                basis: f.get("basis"),
                                value: Number(f.get("value")),
                              }),
                            },
                          );
                          setRules(
                            await request(
                              `/rules/${encodeURIComponent(active.driverId)}`,
                            ),
                          );
                          setEditingRule(null);
                        });
                      }}
                    >
                      <label>
                        Description
                        <input
                          name="description"
                          required
                          defaultValue={editingRule.description}
                        />
                      </label>
                      <label>
                        Action
                        <select name="kind" defaultValue={editingRule.kind}>
                          <option value="add">Add</option>
                          <option value="subtract">Subtract</option>
                        </select>
                      </label>
                      <label>
                        Calculate as
                        <select name="basis" defaultValue={editingRule.basis}>
                          <option value="fixed">Fixed amount</option>
                          <option value="percent">% of movement pay</option>
                        </select>
                      </label>
                      <label>
                        Value
                        <input
                          name="value"
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          defaultValue={editingRule.value}
                        />
                      </label>
                      <button className="primary-btn" disabled={busy}>
                        Save option
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => setEditingRule(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                  <p>
                    Choose an adjustment to add to this period. Review its
                    amount or percentage before saving. Nothing is applied
                    automatically.
                  </p>
                  <button
                    className="secondary-btn"
                    disabled={busy}
                    onClick={() =>
                      run(async () =>
                        setRules(
                          await request(
                            `/rules/${encodeURIComponent(active.driverId)}`,
                          ),
                        ),
                      )
                    }
                  >
                    Refresh saved adjustments
                  </button>
                  <table>
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th>Calculation</th>

                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((r) => (
                        <tr key={r.id}>
                          <td>{r.description}</td>
                          <td>
                            {r.kind === "add" ? "+" : "−"}
                            {r.basis === "percent"
                              ? `${r.value}%`
                              : money(r.value)}
                          </td>

                          <td>{r.active ? "Active" : "Paused"}</td>
                          <td>
                            {editable && (
                              <button
                                className="primary-btn"
                                disabled={
                                  busy ||
                                  !r.active ||
                                  adjustments.some(
                                    (a) => a.calculation?.ruleId === r.id,
                                  )
                                }
                                onClick={() => {
                                  setEditingAdjustment({
                                    savedRuleId: r.id,
                                    description: r.description,
                                    calculation: r,
                                  });
                                  setTab("Adjustments");
                                }}
                              >
                                {adjustments.some(
                                  (a) => a.calculation?.ruleId === r.id,
                                )
                                  ? "Already added"
                                  : "Select for this period"}
                              </button>
                            )}
                            <button
                              className="secondary-btn"
                              disabled={busy}
                              onClick={() => setEditingRule(r)}
                            >
                              Edit saved option
                            </button>
                            <button
                              className="secondary-btn"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `${r.active ? "Pause" : "Resume"} ${r.description} as a saved option? Existing periods will not change.`,
                                  )
                                )
                                  run(async () => {
                                    await request(
                                      `/rules/${encodeURIComponent(r.id)}`,
                                      {
                                        method: "PUT",
                                        body: JSON.stringify({
                                          active: !r.active,
                                        }),
                                      },
                                    );
                                    setRules(
                                      await request(
                                        `/rules/${encodeURIComponent(active.driverId)}`,
                                      ),
                                    );
                                  });
                              }}
                            >
                              {r.active ? "Pause" : "Resume"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              {tab === "Documents" && (
                <>
                  <h3>
                    {documentLoad?.id ||
                      "Select a movement to review documents"}
                  </h3>
                  <p>
                    Documents are displayed for the selected load. Payment
                    remains tied to the individual movement.
                  </p>
                  {(documentLoad?.documents || []).map((doc) => (
                    <button
                      key={doc.id}
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const response = await fetch(
                            `${apiBase}/api/documents/${encodeURIComponent(doc.id)}/file`,
                            { headers: { Authorization: `Bearer ${token}` } },
                          );
                          if (!response.ok)
                            throw new Error("Document is unavailable.");
                          setDocumentUrl(
                            URL.createObjectURL(await response.blob()),
                          );
                        })
                      }
                    >
                      {doc.category || doc.type || "Document"} · {doc.name}
                    </button>
                  ))}
                  {documentLoad && !(documentLoad.documents || []).length && (
                    <p>
                      No documents available in the loaded records. Refresh the
                      load data or check the load in Dispatch.
                    </p>
                  )}
                  {documentUrl && (
                    <iframe
                      title="Load document"
                      src={documentUrl}
                      style={{ width: "100%", height: 480, border: 0 }}
                    />
                  )}
                </>
              )}
              {tab === "Notes" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => mutate("", "PUT", { notes: note }));
                  }}
                >
                  <label>
                    Payroll note
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      disabled={!editable || busy}
                    />
                  </label>
                  {editable && (
                    <button className="primary-btn" disabled={busy}>
                      Save note
                    </button>
                  )}
                </form>
              )}
              {tab === "History" && (
                <>
                  <h3>Version history</h3>
                  {active.versions?.map((v) => (
                    <p key={v.id}>
                      {v.createdAt} · {v.reason}{" "}
                      <button
                        className="secondary-btn"
                        onClick={() =>
                          download(`/versions/${encodeURIComponent(v.id)}/pdf`)
                        }
                      >
                        Download replaced version
                      </button>
                    </p>
                  ))}
                  {active.payment && (
                    <p>
                      Paid {money(active.payment.amount)} on{" "}
                      {active.payment.paidOn} · {active.payment.method} ·{" "}
                      {active.payment.reference}
                    </p>
                  )}
                  <ul>
                    {statement.auditTrail.map((a) => (
                      <li key={a.id}>
                        <strong>{a.action.replaceAll("_", " ")}</strong>
                        <p>
                          {a.changedBy || "System"} · {a.createdAt}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <footer>
              <button
                className="secondary-btn"
                onClick={() => download()}
                disabled={busy}
              >
                Download PDF
              </button>
              <div>
                {editable && (
                  <>
                    <button
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() =>
                        run(() => mutate("/recalculate", "POST", {}))
                      }
                    >
                      Refresh totals
                    </button>
                    <button
                      className="primary-btn"
                      disabled={busy || !statement.loads.length}
                      onClick={() => transition("review")}
                    >
                      Mark reviewed
                    </button>
                  </>
                )}
                {status === "Reviewed" && (
                  <>
                    <button
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => transition("unreview")}
                    >
                      Return to Draft
                    </button>
                    <button
                      className="primary-btn"
                      disabled={busy}
                      onClick={() => transition("finalize")}
                    >
                      Finalize settlement
                    </button>
                  </>
                )}
                {status === "Finalized" && (
                  <>
                    <button
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => transition("reopen")}
                    >
                      Create revision
                    </button>
                    <button
                      className="primary-btn"
                      disabled={busy || statement.totals.netPay <= 0}
                      onClick={() => setPaymentOpen(true)}
                    >
                      Record payment
                    </button>
                  </>
                )}
                {status === "Paid" && (
                  <button
                    className="primary-btn"
                    disabled={busy}
                    onClick={() => setCorrectionOpen(true)}
                  >
                    Create correction
                  </button>
                )}
                {["Reviewed", "Finalized", "Paid"].includes(status) && (
                  <button
                    className="secondary-btn"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Email the current statement to ${statement.driver.email || "this driver"}?`,
                        )
                      )
                        run(async () => {
                          await request(
                            `/${encodeURIComponent(active.id)}/send-email`,
                            { method: "POST", body: "{}" },
                          );
                          const result = await request(
                            `/${encodeURIComponent(active.id)}`,
                          );
                          setActive(result);
                        });
                    }}
                  >
                    Email driver
                  </button>
                )}
              </div>
            </footer>
          </>
        )}
      </dialog>
    </section>
  );
}

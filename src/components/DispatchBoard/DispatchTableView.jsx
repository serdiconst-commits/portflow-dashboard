export default function DispatchTableView({
  filteredLoadsData,
  orderedDispatchLoadColumns,
  draggedDispatchColumn,
  handleDispatchColumnDragStart,
  setDraggedDispatchColumn,
  handleDispatchColumnDrop,
  selectedLoad,
  setSelectedLoad,
  setIsEditing,
  onDriverReleaseChange,
  getDriverLabel,
}) {
  return (
    <div className="dispatch-sheet-wrap">
      {filteredLoadsData.length > 0 ? (
        <table className="dispatch-load-sheet">
          <thead>
            <tr>
              <th className="release-column">
                <span>Release</span>
              </th>
              {orderedDispatchLoadColumns.map((column) => (
                <th
                  key={column.key}
                  draggable
                  className={draggedDispatchColumn === column.key ? 'dragging-column' : ''}
                  onDragStart={(event) => handleDispatchColumnDragStart(event, column.key)}
                  onDragEnd={() => setDraggedDispatchColumn('')}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDispatchColumnDrop(event, column.key)}
                  title="Drag to move this column"
                >
                  <span className="column-drag-handle" aria-hidden="true">::</span>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredLoadsData.map((load) => (
              <tr
                key={load.id}
                className={selectedLoad?.id === load.id ? 'selected' : ''}
                onClick={() => {
                  setSelectedLoad(load);
                  setIsEditing(false);
                }}
              >
                <td className="release-column">
                  <button
                    type="button"
                    className={`driver-release-check ${Number(load.isDriverReleased ?? 1) === 1 ? 'released' : 'pending'}`}
                    aria-label={
                      Number(load.isDriverReleased ?? 1) === 1
                        ? `Return ${load.id} to dispatch-only`
                        : `Release ${load.id} to ${getDriverLabel?.(load.driver) || 'driver'}`
                    }
                    title={
                      load.driver
                        ? Number(load.isDriverReleased ?? 1) === 1
                          ? 'Released to driver — click to return to dispatch-only'
                          : 'Pending release — click to make visible to driver'
                        : 'Assign a driver before release'
                    }
                    disabled={!load.driver}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDriverReleaseChange?.(load, Number(load.isDriverReleased ?? 1) !== 1);
                    }}
                  >
                    {Number(load.isDriverReleased ?? 1) === 1 ? (
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="m5 10.5 3 3L15.5 6" />
                      </svg>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </button>
                </td>
                {orderedDispatchLoadColumns.map((column) => (
                  <td key={`${load.id}-${column.key}`}>{column.render(load)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="empty-state">
          <p>No loads found with those filters.</p>
        </div>
      )}
    </div>
  );
}

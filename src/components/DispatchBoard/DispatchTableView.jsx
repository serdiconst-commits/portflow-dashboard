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
}) {
  return (
    <div className="dispatch-sheet-wrap">
      {filteredLoadsData.length > 0 ? (
        <table className="dispatch-load-sheet">
          <thead>
            <tr>
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

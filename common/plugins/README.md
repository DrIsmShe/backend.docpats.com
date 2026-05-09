# common/plugins

Reusable Mongoose plugins for clinic models.

Files (will be added):

- `tenantScoped.plugin.js` — auto-filters queries by clinicId
- `softDelete.plugin.js` — adds isDeleted flag, filters out deleted by default
- `standardModel.plugin.js` — applies all standard plugins at once

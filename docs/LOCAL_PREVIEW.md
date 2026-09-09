# Local preview on Windows

From the repository folder, run:

```powershell
.\scripts\start-local-preview.ps1
```

This builds the current frontend with the local API address, starts the API and
preview in the background, and waits for both to respond. Open
<http://localhost:5173>. The existing backend `.env` and local database are used.
The script does not migrate or reset the database.

After restarting Windows, run the same command again. To reopen an existing
build without rebuilding, use `-SkipBuild`. Logs are saved under `output/`.
An existing server from this workspace is reused; a port occupied by another
process is reported without stopping it.

The frontend builds into `frontend/dist/local-preview` so other tasks using
`dist/public` and port 5174 can keep their own preview. A counter lock requires
the existing owner PIN to resume the session.

These commands configure only the local preview. Deployed frontend builds still
require `VITE_API_BASE_URL` to point to their deployed backend.

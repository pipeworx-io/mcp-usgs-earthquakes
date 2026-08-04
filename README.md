# mcp-usgs-earthquakes

USGS Earthquake Catalog MCP (FDSNWS event API).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `search_earthquakes` | Search the USGS earthquake catalog (FDSNWS event API) for real-time and historical seismic events. Filter by time window, magnitude, depth, and a circular geographic area. Returns a compact list of quakes with magnitude, location, time, coordinates, depth, and significance. Keyless. |
| `get_earthquake` | Get full detail for a single earthquake by its USGS event id (e.g. "us7000n7n8"). Returns magnitude, location, time, depth, felt reports, tsunami flag, PAGER alert level, status, contributing networks, and detail URLs. Keyless. |
| `count_earthquakes` | Count earthquakes matching a filter without returning the events — fast for questions like "how many M5+ quakes in the last month near X". Same filters as search_earthquakes (time, magnitude, circular area). Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "usgs-earthquakes": {
      "url": "https://gateway.pipeworx.io/usgs-earthquakes/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Usgs Earthquakes data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

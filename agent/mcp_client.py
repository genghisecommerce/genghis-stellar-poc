"""Call one tool on the Genghis MCP server over the real MCP stdio protocol."""
import asyncio, json, os, sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main(tool, args):
    params = StdioServerParameters(command=sys.executable, args=["genghis_catalog.py"], env=dict(os.environ))
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            res = await s.call_tool(tool, args)
            text = "".join(c.text for c in res.content if getattr(c, "text", None))
            print(text)

asyncio.run(main(sys.argv[1], json.loads(sys.argv[2])))

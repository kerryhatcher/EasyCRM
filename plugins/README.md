# EasyCRM plugin source

The portable source is in [`easycrm/`](easycrm/). Build it from the repository
root with `python scripts/package_plugin.py --output /tmp/easycrm-plugin.zip`.

The initial private account plugin is
[EasyCRM](https://chatgpt.com/plugins/plugins_6ae505479044819180fe57a1f29fc2d9),
version `1.0.0`, release `pluginrel_6ae50548268081919b43a3a72872b260`.
Its visibility is private; the link alone does not grant another account access.
Share the source or generated ZIP for independent installation. This is not a
public-directory submission.

The saved release was inspected to confirm that the MCP connection and
`manage-crm` skill were retained. The existing authenticated MCP server was
verified with a read-only search. A new ChatGPT host connection still requires
its own OAuth client registration and user sign-in; see the
[OAuth setup instructions](easycrm/README.md#oauth-setup).

To update this account plugin later, update the existing plugin ID
`plugins_6ae505479044819180fe57a1f29fc2d9` rather than creating another copy.
The service may generate compatibility manifests during import; the portable
manifests in this repository remain the source for independently built ZIPs.

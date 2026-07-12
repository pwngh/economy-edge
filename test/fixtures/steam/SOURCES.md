# Steam — sources

- ISteamMicroTxn: https://partner.steamgames.com/doc/webapi/ISteamMicroTxn
- Sandbox: https://partner.steamgames.com/doc/webapi/ISteamMicroTxnSandbox
- Implementation guide (status, error, and report appendices):
  https://partner.steamgames.com/doc/features/microtransactions/implementation
- Web API auth and responses:
  https://partner.steamgames.com/doc/webapi_overview/auth

No OpenAPI, but `ISteamWebAPIUtil/GetSupportedAPIList`, called with the publisher key,
returns method and parameter metadata for the publisher-only methods. Unofficial
community dump: https://steamapi.xpaw.me/

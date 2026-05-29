# BRIGHTDATA_400_REPORT

Generated: 2026-05-29  
Campaign under test: `40cf1d98-1eae-4ca2-ad23-5cfd71e4bb2b`

---

## Exact Request

**Endpoint**
```
POST https://api.brightdata.com/request
```

**Headers** (API key redacted)
```
Authorization: Bearer <redacted>
Content-Type: application/json
```

**Payload**
```json
{
  "zone": "serp_api2",
  "url": "https://www.google.com/search?q=site:github.com+language:python+fastapi+stars:>50",
  "format": "json"
}
```

---

## Exact Bright Data Response

**HTTP Status**: `400 Bad Request`

**Response Headers**
```
content-type: application/json; charset=utf-8
content-length: 282
access-control-allow-origin: *
```

**Response Body** (full, 282 bytes)
```json
{
  "error": "Request validation failed",
  "error_code": "validation",
  "details": [
    {
      "message": "\"url\" must be a valid uri",
      "path": ["url"],
      "type": "string.uri",
      "context": {
        "label": "url",
        "value": "https://www.google.com/search?q=site:github.com+language:python+fastapi+stars:>50",
        "key": "url"
      }
    }
  ]
}
```

---

## Root Cause

**Category C — Invalid payload format** (URL field contains an unencoded character)

Bright Data's `/request` endpoint validates the `url` field as a strict URI. The URL passed contains the `>` character in the query string (`stars:>50`), which is **not a valid URI character** and must be percent-encoded as `%3E`.

### How the invalid URL is constructed

```python
# bright_data_service.py:88-89
search_url = f"https://www.google.com/search?q=site:github.com+{query.replace(' ', '+')}"
```

The `query` string comes from Featherless AI's signal extraction. Example output:
```
"language:python fastapi stars:>50"
```

After `.replace(' ', '+')`:
```
"language:python+fastapi+stars:>50"
```

Resulting URL sent to Bright Data:
```
https://www.google.com/search?q=site:github.com+language:python+fastapi+stars:>50
                                                                           ^
                                                                    invalid character
```

`.replace(' ', '+')` only escapes spaces. The `>` character from the GitHub search syntax
`stars:>50` passes through unescaped. The `>` character is invalid in a URI per RFC 3986
and Bright Data's API server rejects it with a 400 validation error.

---

## Zone / Endpoint / Account Assessment

| Item | Status | Evidence |
|---|---|---|
| Zone `serp_api2` | **OK** — not the cause | Bright Data's error is `string.uri` validation, not a zone error. Zone errors return a different error code. |
| Endpoint `https://api.brightdata.com/request` | **OK** | HTTP 400 with structured JSON body is expected behaviour for a bad request (not a 404 or 503). |
| API key | **OK** | 401 would be returned for an invalid key; this is 400 with `validation` error code. |
| Account permissions | **OK** | Permission errors return different error codes. |
| Bright Data API change | **Unlikely** | The response is a clean RFC-compliant validation error; the endpoint is behaving correctly. |

---

## Confidence Level

**VERY HIGH** — The Bright Data response body is unambiguous:

```json
{"error":"Request validation failed","error_code":"validation",
 "details":[{"message":"\"url\" must be a valid uri","path":["url"],
             "type":"string.uri"}]}
```

The rejected value is printed verbatim in the `context.value` field. The `>` character is the
only non-URI character in the URL. This is not a transient error — every search query that
Featherless generates with `stars:>N` or `followers:>N` syntax will reproduce the same 400.

---

## Fix Required

In `apps/backend/services/bright_data_service.py`, `search_candidates_serp()`, line 88:

Replace the manual space→`+` substitution with proper query-string percent-encoding using
`urllib.parse.quote`. The `>` in GitHub search operator syntax (`stars:>50`) must become
`%3E`. Spaces in the query should remain `+` (standard for `application/x-www-form-urlencoded`).

Minimal correct fix:
```python
from urllib.parse import quote

# Encode the query: spaces → +, special chars (> < : etc.) → %XX
encoded_query = quote(f"site:github.com {query}", safe="+:")
search_url = f"https://www.google.com/search?q={encoded_query}"
```

Or equivalently, preserve the existing `+`-for-space approach but also encode `>` and `<`:
```python
search_url = (
    f"https://www.google.com/search?q=site:github.com+"
    + query.replace(" ", "+").replace(">", "%3E").replace("<", "%3C")
)
```

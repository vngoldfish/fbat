import time
import database

def handle_accounts_route(path: str, method: str, body: dict = None) -> tuple:
    # GET /api/accounts
    if path == "/api/accounts" and method == "GET":
        accounts = database.get_collection("accounts")
        return 200, {"accounts": accounts, "total": len(accounts)}

    # POST /api/accounts
    if path == "/api/accounts" and method == "POST":
        payload = body or {}
        name = payload.get("name")
        access_token = payload.get("accessToken")

        if not name or not access_token:
            return 400, {"error": "Name and Access Token are required"}

        account = {
            "id": f"acc_{int(time.time() * 1000)}",
            "name": name,
            "type": payload.get("type", "page"), # page | group | user
            "targetId": payload.get("targetId", ""),
            "accessToken": access_token,
            "status": "active",
            "createdAt": int(time.time() * 1000)
        }

        database.insert_item("accounts", account)
        database.add_log("ADD_FB_ACCOUNT", {"accId": account["id"], "name": account["name"]})
        return 201, {"success": True, "account": account}

    # GET /api/accounts/targets (Fanpages & Groups)
    if path == "/api/accounts/targets" and method == "GET":
        targets = database.get_collection("targets")
        return 200, {"targets": targets, "total": len(targets)}

    # POST /api/accounts/targets (Sync discovered Fanpages & Groups)
    if path == "/api/accounts/targets" and method == "POST":
        payload = body or {}
        targets_list = payload.get("targets", [])
        database.save_collection("targets", targets_list)
        database.add_log("SYNC_TARGETS", {"count": len(targets_list)})
        return 200, {"success": True, "count": len(targets_list)}

    # DELETE /api/accounts/<id>
    if path.startswith("/api/accounts/") and method == "DELETE":
        acc_id = path.replace("/api/accounts/", "")
        deleted = database.delete_item("accounts", acc_id)
        if deleted:
            database.add_log("DELETE_FB_ACCOUNT", {"accId": acc_id})
            return 200, {"success": True, "id": acc_id}
        return 404, {"error": "Account not found"}

    return 404, {"error": "Accounts Route not found"}

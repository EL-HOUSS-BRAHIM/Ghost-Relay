Logic Update: Missing HTTP Endpoints

The main.js is missing the logic to Register and Fetch Users via HTTP.
Please add the following two functions and integrate them into the app initialization flow.

Crucial Security Requirement:
Every fetch call MUST include the header:
"X-Ghost-Auth": APP_SECRET

1. Function: registerUser(username, publicKey, encKey)

Endpoint: POST /api/register

Body: JSON { "username": ..., "public_key": ..., "encryption_key": ... }

Headers: Content-Type: application/json AND X-Ghost-Auth: APP_SECRET

Logic:

Call this when the user clicks "Register" or "Login" for the first time.

If response is 200 OK: Save user data to localStorage.

If response is 403 Forbidden: Alert "Invalid App Secret".

If response is 409 Conflict: Alert "Username taken".

2. Function: syncUserList()

Endpoint: GET /api/users

Headers: X-Ghost-Auth: APP_SECRET (No body needed)

Logic:

Call this automatically every 60 seconds OR when the app loads.

Save the list (Username + Public Keys) to localStorage.

Update the UI "Contacts" sidebar with the new users.

3. Integration

Ensure these functions are called before the WebSocket connects.

The flow should be:

App Start.

Check if Keys exist in localStorage.

If No: Show Login Screen -> User enters Name/Pass -> Generate Keys -> Call registerUser.

If Yes: Call syncUserList -> Connect WebSocket (connectWs).
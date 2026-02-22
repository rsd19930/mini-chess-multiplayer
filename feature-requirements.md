**Introduction & Goals**
I want this to be a mobile-designed 2-player online multiplayer version of a 6x6 "Crazyhouse" style chess variant. The focus is on quick, engaging gameplay with a simple interface. Allow a 2 player multiplayer game and make a simple bot join in - call it Kodiac - if a player doesn't find a match within 1 minute(make this timer config driven). I am targeting casual chess players with this game. Make it as modularised as possible to ensure future expandability and easy changes and refactoring. 


**Matchmaking Logic**
1. Receive "request_match" from Client A
2. Check for Existing Waiting Player
3. Query a list/queue of players currently waiting for a match
4. If Player B is waiting, Create a new game room (e.g., assign a unique game ID). Assign Player A as White and Player B as Black (or vice-versa).
5. If No Player is Waiting, Add Client A to the waiting queue. Start a 60-second server-side timer for Client A's matchmaking request.
6. During the 60-second Timer for Client A, If a new "request_match" is received from Client C, Pair Client A and Client C as described above (remove A from queue, create room, send "match_found").
7. If Client A's 60-second Timer Expires and No Human Match Found, Create a new game room with Client A and a Bot. Assign Client A as White (or random). The Bot will play the other color.

**Edge Cases/Considerations**
- Simultaneous requests: Handle race conditions if multiple players request a match at nearly the same instant. A locking mechanism or careful queue management is needed.
- Client disconnects during matchmaking: Server should remove them from the queue. If they were about to be matched, the other player goes back to waiting or gets a bot.
- Network errors: Graceful handling and feedback to the user (e.g., "Connection lost, please try again").
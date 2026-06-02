# Fair Play Football - Ideal Component Structure

## 📁 Project Architecture Overview

```
fair-play-football/
├── app/                          # Next.js 16 app router
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Homepage
│   ├── admin/
│   │   └── page.tsx             # Admin dashboard
│   ├── bookings/
│   │   └── page.tsx             # User's booking history
│   └── api/                     # API routes (future)
│       └── webhooks/
│
├── components/                   # Organized by feature/domain
│   ├── shared/                  # Reusable across all features
│   │   ├── ui/                  # Pure UI components
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   └── Toast.tsx
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   ├── Container.tsx
│   │   │   └── Section.tsx
│   │   └── loading/
│   │       ├── GameCardSkeleton.tsx
│   │       └── PlayerListSkeleton.tsx
│   │
│   ├── games/                   # Game browsing & display
│   │   ├── GameCard.tsx         # Single game display
│   │   ├── GameCardSkeleton.tsx
│   │   ├── GameList.tsx         # List of all games
│   │   ├── GameGrid.tsx         # Grid layout wrapper
│   │   ├── GameDetails.tsx      # Full game info modal
│   │   ├── GameFilters.tsx      # Filter by location, time, etc
│   │   ├── AvailabilityBadge.tsx
│   │   └── PriceTag.tsx
│   │
│   ├── booking/                 # Booking flow & management
│   │   ├── BookingForm.tsx      # Main booking form
│   │   ├── PlayerNameInput.tsx
│   │   ├── BookingButton.tsx
│   │   ├── BookingConfirm.tsx
│   │   ├── SuccessMessage.tsx
│   │   ├── ErrorMessage.tsx
│   │   └── BookingHistory.tsx
│   │
│   ├── players/                 # Player list & management
│   │   ├── PlayerList.tsx       # Container for all players
│   │   ├── PlayerBadge.tsx      # Individual player display
│   │   ├── PlayerAvatar.tsx
│   │   ├── PlayerCard.tsx
│   │   └── PlayerActions.tsx    # Leave game, message, etc
│   │
│   ├── waitlist/                # Waiting list feature
│   │   ├── WaitlistForm.tsx
│   │   ├── WaitlistList.tsx
│   │   ├── WaitlistItem.tsx
│   │   ├── WaitlistStatus.tsx
│   │   └── JoinWaitlistButton.tsx
│   │
│   ├── admin/                   # Admin-only components
│   │   ├── GameCreateForm.tsx   # Create game form
│   │   ├── GameEditForm.tsx
│   │   ├── GameDeleteButton.tsx
│   │   ├── GameApprovalQueue.tsx
│   │   ├── StatsOverview.tsx
│   │   ├── AdminNav.tsx
│   │   └── AdminLayout.tsx
│   │
│   └── analytics/               # Analytics & reporting (future)
│       ├── StatCard.tsx
│       └── Chart.tsx
│
├── hooks/                        # Custom React hooks
│   ├── queries/
│   │   ├── useGames.ts          # Fetch & manage games
│   │   ├── useGame.ts           # Single game details
│   │   ├── useBookings.ts       # User's bookings
│   │   ├── useWaitlist.ts       # Waiting list
│   │   └── useGameStats.ts
│   ├── mutations/
│   │   ├── useCreateGame.ts
│   │   ├── useBookGame.ts
│   │   ├── useLeaveGame.ts
│   │   ├── useCancelBooking.ts
│   │   └── useJoinWaitlist.ts
│   ├── state/
│   │   ├── useGameFilters.ts    # Filter state management
│   │   └── useBookingFlow.ts    # Multi-step booking state
│   └── ui/
│       └── useToast.ts          # Toast notifications
│
├── lib/                          # Utilities & helpers
│   ├── supabase.ts              # Supabase client
│   ├── api.ts                   # API client wrapper
│   ├── validators.ts            # Form validation
│   ├── helpers.ts               # Utility functions
│   ├── constants.ts             # App constants
│   ├── dates.ts                 # Date formatting
│   └── colors.ts                # Color utility (theme)
│
├── types/                        # TypeScript definitions
│   ├── game.ts
│   ├── booking.ts
│   ├── player.ts
│   ├── waitlist.ts
│   ├── admin.ts
│   └── api.ts
│
├── context/                      # React Context (if needed)
│   ├── AuthContext.tsx          # User authentication
│   ├── ThemeContext.tsx         # Dark/Light theme
│   └── ToastContext.tsx         # Toast notifications
│
├── styles/                       # Global styles
│   ├── globals.css
│   └── tailwind.config.ts
│
├── public/                       # Static assets
│   ├── icons/
│   ├── images/
│   └── favicons/
│
└── config/                       # App configuration
    ├── site.ts                  # Site metadata
    └── env.ts                   # Environment validation
```

---

## 🎯 Component Responsibilities by Feature

### **1. SHARED / REUSABLE COMPONENTS**

#### `shared/ui/` - Design System Components
```
Button.tsx
├─ Props: variant, size, disabled, loading, icon, children
├─ Variants: primary, secondary, danger, ghost
├─ Sizes: sm, md, lg
└─ Used in: Every page

Input.tsx
├─ Props: type, placeholder, error, icon, disabled
└─ Used in: Forms (booking, game creation)

Badge.tsx
├─ Props: variant, size, icon, children
├─ Variants: success, warning, danger, info
└─ Used in: Availability status, spots left

Card.tsx
├─ Props: children, className, clickable, hover
└─ Base container for games, players

Modal.tsx / Dialog.tsx
├─ Props: isOpen, onClose, title, children, size
└─ Used in: Game details, confirmation dialogs
```

#### `shared/layout/` - Layout Components
```
Header.tsx
├─ Logo, Navigation, User menu
├─ Responsive: Mobile nav toggle

Container.tsx
├─ Max-width wrapper with padding
├─ Props: children, size (sm, md, lg)

Section.tsx
├─ Semantic section with spacing
└─ Props: title, description, children

Footer.tsx
└─ Links, copyright, contact
```

---

### **2. GAMES FEATURE**

```
GameCard.tsx
├─ Responsibility: Display single game summary
├─ Props: game, isLoading
├─ Shows: Title, location, time, price, availability
├─ Size: Optimized for grid/list display
└─ No interactions (stateless)

GameList.tsx
├─ Responsibility: Container for game list
├─ Props: games[], loading, error
├─ Layout: Flex column (mobile) / Grid (desktop)
└─ Handles: Loading states, empty states

GameGrid.tsx
├─ Responsibility: Responsive grid wrapper
├─ Grid: 1 col (mobile) → 2 cols (tablet) → 3 cols (desktop)
└─ Spacing & gap management

GameDetails.tsx
├─ Responsibility: Full game modal/page
├─ Props: gameId, onClose
├─ Shows: Description, full player list, booking form
└─ Modal or expanded card

GameFilters.tsx
├─ Responsibility: Filter UI (location, date, price range)
├─ Props: onFilterChange
└─ Uses: useGameFilters hook

AvailabilityBadge.tsx
├─ Responsibility: Visual availability status
├─ Props: spotsLeft, maxSpots
├─ Shows: 🔥 5 Left | ⚠️ 2 Left | 🚫 Full
└─ Color: Green → Yellow → Red

PriceTag.tsx
├─ Responsibility: Price display
├─ Props: price, currency (default: £)
└─ Formatting: £25 with styling
```

---

### **3. BOOKING FEATURE**

```
BookingForm.tsx
├─ Responsibility: Multi-step booking flow
├─ Steps:
│  1. Enter name
│  2. Confirm details
│  3. Show success
├─ Props: gameId, onSuccess
└─ Handles: Validation, loading, errors

PlayerNameInput.tsx
├─ Responsibility: Name input with validation
├─ Props: value, onChange, error, disabled
└─ Validation: Min 2 chars, no special chars

BookingButton.tsx
├─ Responsibility: CTA button with loading state
├─ Props: onClick, disabled, loading
└─ Text: "Book Now" → "Booking..." → "Booked!"

BookingConfirm.tsx
├─ Responsibility: Confirmation dialog
├─ Shows: Game details, player name, price
├─ Props: game, playerName, onConfirm, onCancel
└─ Action: "Confirm Booking" or "Cancel"

SuccessMessage.tsx
├─ Responsibility: Success feedback
├─ Shows: "You're In! See You On The Pitch 👍"
├─ Animation: Pulsing for 2s
└─ Auto-dismiss

ErrorMessage.tsx
├─ Responsibility: Error feedback
├─ Shows: Error reason (duplicate, full, etc)
└─ Dismissible

BookingHistory.tsx
├─ Responsibility: User's past/upcoming bookings
├─ Props: userId
└─ Filters: Upcoming, Past, Cancelled
```

---

### **4. PLAYERS FEATURE**

```
PlayerList.tsx
├─ Responsibility: Container for all players
├─ Props: bookings[], gameId, onLeaveGame
├─ Layout: Flex wrap with gaps
└─ Filtering: By game

PlayerBadge.tsx
├─ Responsibility: Compact player display (in list)
├─ Props: playerName, bookingId, onLeave
├─ Shows: Avatar + name + leave button
├─ Compact: 48x48 avatar

PlayerCard.tsx
├─ Responsibility: Expanded player info (modal/detailed view)
├─ Props: player, booking
├─ Shows: Avatar, name, join date, games played
└─ More details for future profiles

PlayerAvatar.tsx
├─ Responsibility: Avatar circle with initials
├─ Props: playerName, size, color
└─ Generates: First letter avatar

PlayerActions.tsx
├─ Responsibility: Leave, message, block buttons
├─ Props: playerId, bookingId
└─ Actions: Leave game, message, report
```

---

### **5. WAITLIST FEATURE**

```
WaitlistForm.tsx
├─ Responsibility: Form to join waitlist
├─ Props: gameId, onSuccess
└─ Fields: Name only (reuse from booking)

WaitlistList.tsx
├─ Responsibility: Show waitlist queue
├─ Props: gameId, waitlist[]
├─ Shows: Position, player names
└─ Only visible if game full

WaitlistItem.tsx
├─ Responsibility: Individual waitlist entry
├─ Props: position, playerName
└─ Shows: #2 - John Smith

WaitlistStatus.tsx
├─ Responsibility: "You're #5 on waitlist"
├─ Props: position, gameId
└─ Shows: Position, estimated wait

JoinWaitlistButton.tsx
├─ Responsibility: CTA for full games
├─ Props: gameId, onJoin
└─ Shows: "Join Waitlist" (when game full)
```

---

### **6. ADMIN FEATURE**

```
GameCreateForm.tsx
├─ Responsibility: Create new game
├─ Fields: Title, location, time, price, max spots
├─ Validation: All required, price > 0
├─ Submit: Creates game + redirects

GameEditForm.tsx
├─ Responsibility: Edit existing game
├─ Props: gameId
├─ Pre-fill: Current game data
└─ Submit: Update + redirect

GameDeleteButton.tsx
├─ Responsibility: Soft-delete game
├─ Props: gameId, onDelete
└─ Confirmation: Modal

GameApprovalQueue.tsx
├─ Responsibility: Pending games (if needed)
├─ Shows: Unapproved games list
└─ Actions: Approve, reject, edit

StatsOverview.tsx
├─ Responsibility: Admin dashboard stats
├─ Shows:
│  - Total games
│  - Total bookings
│  - Revenue
│  - Active players
└─ Future: Charts, trends

AdminNav.tsx
├─ Responsibility: Admin navigation menu
└─ Links: Games, Bookings, Waitlist, Stats

AdminLayout.tsx
├─ Responsibility: Admin page wrapper
├─ Includes: Sidebar nav, header
└─ Permission check (future auth)
```

---

## 🪝 Custom Hooks Organization

### `hooks/queries/` - Data Fetching
```typescript
useGames()
├─ Returns: { games, loading, error, refetch }
└─ Triggers: On mount

useGame(gameId)
├─ Returns: { game, loading, error }
└─ Single game details

useBookings(userId?)
├─ Returns: { bookings, loading, error }
└─ User's bookings or all bookings (admin)

useWaitlist(gameId)
├─ Returns: { waitlist, position, loading }
└─ Waiting list for game

useGameStats()
├─ Returns: { stats, loading, error }
└─ Admin stats (games, revenue, etc)
```

### `hooks/mutations/` - Data Mutations
```typescript
useBookGame()
├─ Returns: { mutate, loading, error }
├─ Validates: Duplicate check, spots available
└─ Success: Reset form, show message

useLeaveGame()
├─ Returns: { mutate, loading, error }
└─ Removes booking + refetch

useCreateGame()
├─ Returns: { mutate, loading, error }
└─ Admin: Create game

useCancelBooking()
├─ Returns: { mutate, loading, error }
└─ User: Cancel booking

useJoinWaitlist()
├─ Returns: { mutate, loading, error }
└─ Join queue if game full
```

### `hooks/state/` - Local State
```typescript
useGameFilters()
├─ Returns: { filters, setFilters, reset }
└─ Manages: Location, date, price range

useBookingFlow()
├─ Returns: { step, next, prev, reset }
├─ Steps: 1. Name → 2. Confirm → 3. Success
└─ Multi-step form state

useToast()
├─ Returns: { show, hide }
└─ Show notifications
```

---

## 📦 Types Organization

```typescript
// types/game.ts
interface Game {
  id: number
  title: string
  location: string
  time: string
  price: number
  spots_left: number
  max_spots: number
  created_by: string
  created_at: string
}

// types/booking.ts
interface Booking {
  id: number
  game_id: number
  player_name: string
  created_at: string
}

// types/waitlist.ts
interface WaitlistEntry {
  id: number
  game_id: number
  player_name: string
  position: number
  joined_at: string
}

// types/api.ts
interface ApiResponse<T> {
  data?: T
  error?: string
}
```

---

## 🛠️ Best Practices for Scaling

### **1. Component Composition**
- ✅ Keep components small (< 300 lines)
- ✅ Use composition over inheritance
- ✅ Props drilling minimized (use Context or state management if > 3 levels)
- ✅ Stateless components when possible

### **2. File Organization**
- ✅ Co-locate styles, tests with components
- ✅ Group by feature, not by type (feature-first)
- ✅ Separate UI (shared) from business logic
- ✅ Clear responsibilities per file

### **3. Styling**
- ✅ Use Tailwind utilities (no custom CSS)
- ✅ Create utility classes for repeated patterns
- ✅ Dark mode via Tailwind dark: prefix
- ✅ Responsive-first approach (mobile → desktop)

### **4. Data Management**
- ✅ Custom hooks for Supabase queries
- ✅ Separate queries from mutations
- ✅ Validation in hooks, not components
- ✅ Loading/error states in UI

### **5. TypeScript**
- ✅ No `any` types (use `unknown` if needed)
- ✅ Interface for props
- ✅ Separate types/ folder
- ✅ Generics for reusable hooks

### **6. Performance**
- ✅ Memoize expensive components (React.memo)
- ✅ useCallback for event handlers
- ✅ useMemo for computed values
- ✅ Lazy load admin pages

### **7. Accessibility**
- ✅ Semantic HTML
- ✅ ARIA labels for buttons
- ✅ Keyboard navigation
- ✅ Focus states for all interactive elements

### **8. Error Handling**
- ✅ Try-catch in hooks
- ✅ User-friendly error messages
- ✅ Fallback UI for errors
- ✅ Error boundary (future)

### **9. Testing Strategy** (Future)
- ✅ Unit: Utility functions, hooks
- ✅ Integration: Component + hook interactions
- ✅ E2E: Critical flows (booking, creation)

### **10. Naming Conventions**
```
Components: PascalCase (GameCard.tsx)
Hooks: useX (useGames.ts)
Types: PascalCase (Game interface)
Constants: UPPER_SNAKE_CASE (MAX_SPOTS)
Utils: camelCase (formatDate.ts)
Events: onX (onClick, onSubmit)
Booleans: isX, hasX, canX (isLoading, hasError)
```

---

## 🚀 Migration Path (When Rewriting Code)

1. **Phase 1:** Extract shared UI components (Button, Input, Card)
2. **Phase 2:** Extract custom hooks (useGames, useBookings)
3. **Phase 3:** Build game feature components
4. **Phase 4:** Build booking feature components
5. **Phase 5:** Build admin feature components
6. **Phase 6:** Add waitlist feature
7. **Phase 7:** Refactor pages to use components

---

## 💡 Premium Touches (Startup Quality)

- ✨ Smooth loading skeletons (not spinners)
- ✨ Toast notifications for all actions
- ✨ Optimistic updates (show success before API)
- ✨ Empty states with illustrations
- ✨ Proper error messages (not "Error!")
- ✨ Animations (page transitions, button ripples)
- ✨ Mobile-first responsive design
- ✨ Keyboard shortcuts (future)
- ✨ Dark theme support
- ✨ Analytics & tracking hooks

---

## 📋 Summary

| Layer | Responsibility |
|-------|---|
| **Pages** | Route handling, data fetching triggers |
| **Components** | UI rendering + local interactions |
| **Hooks** | Data logic, state management |
| **Types** | TypeScript interfaces |
| **Lib** | Utilities, API clients |
| **Context** | Global state (auth, theme, toast) |

This structure scales from 10K to 100K lines of code without refactoring. Ready to implement! 🚀

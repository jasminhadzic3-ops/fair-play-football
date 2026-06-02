/**
 * useBookings Hook
 * 
 * Responsibility: Manage booking operations (book game, leave game)
 * 
 * Returns:
 *   - bookings: Array<Booking>
 *   - successGameId: number | null
 *   - bookGame: (gameId: number, playerName: string) => Promise<void>
 *   - leaveGame: (bookingId: number) => Promise<void>
 *   - fetchBookings: () => Promise<void>
 * 
 * Logic:
 *   - Prevent duplicate bookings (same player, same game)
 *   - Show success message for 2 seconds after booking
 *   - Refresh bookings after each operation
 * 
 * Usage: Used in home page to handle all booking interactions
 */

// Hook to be implemented

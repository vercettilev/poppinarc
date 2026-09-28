/**
 * Simple EventEmitter implementation for observable pattern
 */
export class EventEmitter {
  private events: { [key: string]: Function[] } = {}

  /**
   * Subscribe to an event
   * @param event Event name to listen for
   * @param callback Function to call when event is emitted
   * @returns Unsubscribe function
   */
  on(event: string, callback: Function): () => void {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(callback)

    // Return unsubscribe function
    return () => {
      this.events[event] = this.events[event].filter(cb => cb !== callback)
    }
  }

  /**
   * Emit an event with data
   * @param event Event name to emit
   * @param data Data to pass to event listeners
   */
  emit(event: string, data?: any): void {
    if (this.events[event]) {
      this.events[event].forEach(callback => {
        try {
          callback(data)
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error)
        }
      })
    }
  }

  /**
   * Remove all listeners for a specific event
   * @param event Event name to remove listeners for
   */
  off(event: string): void {
    delete this.events[event]
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(): void {
    this.events = {}
  }

  /**
   * Get the number of listeners for a specific event
   * @param event Event name to check
   * @returns Number of listeners
   */
  listenerCount(event: string): number {
    return this.events[event] ? this.events[event].length : 0
  }
} 
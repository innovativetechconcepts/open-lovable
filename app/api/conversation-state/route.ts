import { pilotState } from '@/lib/aidaos/pilot-context';
import { pilotRoute } from '@/lib/aidaos/pilot-route';
import { NextRequest, NextResponse } from 'next/server';
import type { ConversationState } from '@/types/conversation';

declare global {
  var conversationState: ConversationState | null;
}

// GET: Retrieve current conversation state
async function handleGET() {
  try {
    if (!pilotState().conversationState) {
      return NextResponse.json({
        success: true,
        state: null,
        message: 'No active conversation'
      });
    }
    
    return NextResponse.json({
      success: true,
      state: pilotState().conversationState
    });
  } catch (error) {
    console.error('[conversation-state] Error getting state:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

// POST: Reset or update conversation state
async function handlePOST(request: NextRequest) {
  try {
    const { action, data } = await request.json();
    
    switch (action) {
      case 'reset':
        pilotState().conversationState = {
          conversationId: `conv-${Date.now()}`,
          startedAt: Date.now(),
          lastUpdated: Date.now(),
          context: {
            messages: [],
            edits: [],
            projectEvolution: { majorChanges: [] },
            userPreferences: {}
          }
        };
        
        console.log('[conversation-state] Reset conversation state');
        
        return NextResponse.json({
          success: true,
          message: 'Conversation state reset',
          state: pilotState().conversationState
        });
        
      case 'clear-old':
        // Clear old conversation data but keep recent context
        if (!pilotState().conversationState) {
          // Initialize conversation state if it doesn't exist
          pilotState().conversationState = {
            conversationId: `conv-${Date.now()}`,
            startedAt: Date.now(),
            lastUpdated: Date.now(),
            context: {
              messages: [],
              edits: [],
              projectEvolution: { majorChanges: [] },
              userPreferences: {}
            }
          };
          
          console.log('[conversation-state] Initialized new conversation state for clear-old');
          
          return NextResponse.json({
            success: true,
            message: 'New conversation state initialized',
            state: pilotState().conversationState
          });
        }
        
        // Keep only recent data
        pilotState().conversationState.context.messages = pilotState().conversationState.context.messages.slice(-5);
        pilotState().conversationState.context.edits = pilotState().conversationState.context.edits.slice(-3);
        pilotState().conversationState.context.projectEvolution.majorChanges =
          pilotState().conversationState.context.projectEvolution.majorChanges.slice(-2);
        
        console.log('[conversation-state] Cleared old conversation data');
        
        return NextResponse.json({
          success: true,
          message: 'Old conversation data cleared',
          state: pilotState().conversationState
        });
        
      case 'update':
        if (!pilotState().conversationState) {
          return NextResponse.json({
            success: false,
            error: 'No active conversation to update'
          }, { status: 400 });
        }
        
        // Update specific fields if provided
        if (data) {
          if (data.currentTopic) {
            pilotState().conversationState.context.currentTopic = data.currentTopic;
          }
          if (data.userPreferences) {
            pilotState().conversationState.context.userPreferences = {
              ...pilotState().conversationState.context.userPreferences,
              ...data.userPreferences
            };
          }
          
          pilotState().conversationState.lastUpdated = Date.now();
        }
        
        return NextResponse.json({
          success: true,
          message: 'Conversation state updated',
          state: pilotState().conversationState
        });
        
      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action. Use "reset" or "update"'
        }, { status: 400 });
    }
  } catch (error) {
    console.error('[conversation-state] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

// DELETE: Clear conversation state
async function handleDELETE() {
  try {
    pilotState().conversationState = null;
    
    console.log('[conversation-state] Cleared conversation state');
    
    return NextResponse.json({
      success: true,
      message: 'Conversation state cleared'
    });
  } catch (error) {
    console.error('[conversation-state] Error clearing state:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
export const GET = pilotRoute(handleGET);
export const POST = pilotRoute(handlePOST);
export const DELETE = pilotRoute(handleDELETE);

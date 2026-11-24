import React from 'react';
import { Button } from './ui/Button';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = { hasError: false, message: '' };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message || 'Unexpected rendering error.' };
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex items-center justify-center p-6 transition-colors">
          <div className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-2xl p-8 max-w-md w-full text-center space-y-4 shadow-sm">
            <h1 className="text-lg font-semibold text-[#111827] dark:text-[#F8FAFC]">
              Something went wrong
            </h1>
            <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">{this.state.message}</p>
            <Button onClick={() => window.location.reload()}>Reload Application</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

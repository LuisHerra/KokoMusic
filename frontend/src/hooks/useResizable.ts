import { useState, useEffect, useCallback } from 'react';

export function useResizableRightPanel() {
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const savedWidth = localStorage.getItem('koko_right_panel_width');
    if (savedWidth) {
      document.documentElement.style.setProperty('--right-panel-width', savedWidth);
    }
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 280;
      const maxWidth = Math.min(800, window.innerWidth * 0.6);
      
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      document.documentElement.style.setProperty('--right-panel-width', `${clampedWidth}px`);
      localStorage.setItem('koko_right_panel_width', `${clampedWidth}px`);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return { startResize, isResizing };
}

export function useResizableSidebar() {
  const [isResizing, setIsResizing] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('koko_sidebar_width');
    if (saved) {
      return parseInt(saved);
    }
    return 240;
  });

  useEffect(() => {
    const savedWidth = localStorage.getItem('koko_sidebar_width');
    if (savedWidth) {
      document.documentElement.style.setProperty('--sidebar-width', savedWidth);
    }
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      const minWidth = 64; // Collapses down to show only icons
      const maxWidth = Math.min(450, window.innerWidth * 0.45);
      
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      document.documentElement.style.setProperty('--sidebar-width', `${clampedWidth}px`);
      localStorage.setItem('koko_sidebar_width', `${clampedWidth}px`);
      setWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return { startResize, isResizing, width };
}

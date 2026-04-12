import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Layers, Users, AlertTriangle } from 'lucide-react';

const THRESHOLDS = {
  latency: {
    green: 2000,
    yellow: 5000,
    red: 10000
  },
  depth: {
    green: 0.7,
    yellow: 0.4,
    red: 0.2
  },
  reciprocity: {
    green: 0.6,
    yellow: 0.4,
    red: 0.2
  }
};

const INDICATOR_CONFIG = {
  latency: {
    icon: Activity,
    label: 'Response Latency',
    unit: 'ms',
    description: 'Time between message and response',
    inverseScale: true
  },
  depth: {
    icon: Layers,
    label: 'Meta-Level Depth',
    unit: 'score',
    description: 'Conceptual and analytical depth',
    inverseScale: false
  },
  reciprocity: {
    icon: Users,
    label: 'Conversational Reciprocity',
    unit: 'ratio',
    description: 'Engagement balance and turn-taking',
    inverseScale: false
  }
};

const getColorForMetric = (metric, value) => {
  const thresholds = THRESHOLDS[metric];
  const config = INDICATOR_CONFIG[metric];
  
  if (config.inverseScale) {
    if (value <= thresholds.green) return 'green';
    if (value <= thresholds.yellow) return 'yellow';
    return 'red';
  } else {
    if (value >= thresholds.green) return 'green';
    if (value >= thresholds.yellow) return 'yellow';
    return 'red';
  }
};

const COLOR_MAP = {
  green: {
    bg: 'bg-green-500',
    text: 'text-green-700',
    lightBg: 'bg-green-50',
    border: 'border-green-300',
    glow: 'shadow-green-500/50'
  },
  yellow: {
    bg: 'bg-yellow-500',
    text: 'text-yellow-700',
    lightBg: 'bg-yellow-50',
    border: 'border-yellow-300',
    glow: 'shadow-yellow-500/50'
  },
  red: {
    bg: 'bg-red-500',
    text: 'text-red-700',
    lightBg: 'bg-red-50',
    border: 'border-red-300',
    glow: 'shadow-red-500/50'
  }
};

const formatValue = (metric, value) => {
  const config = INDICATOR_CONFIG[metric];
  
  if (metric === 'latency') {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}s`;
    }
    return `${Math.round(value)}ms`;
  }
  
  if (metric === 'depth' || metric === 'reciprocity') {
    return (value * 100).toFixed(0) + '%';
  }
  
  return value.toFixed(2);
};

const HealthIndicator = ({ metric, value, trend, isActive }) => {
  const Icon = INDICATOR_CONFIG[metric].icon;
  const config = INDICATOR_CONFIG[metric];
  const color = getColorForMetric(metric, value);
  const colorScheme = COLOR_MAP[color];
  
  const [showTooltip, setShowTooltip] = useState(false);
  
  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div
        className={`relative p-4 rounded-lg border-2 transition-all duration-300 ${colorScheme.lightBg} ${colorScheme.border} ${
          isActive ? `shadow-lg ${colorScheme.glow}` : 'shadow-sm'
        }`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center space-x-2">
            <div className={`p-2 rounded-full ${colorScheme.bg} bg-opacity-20`}>
              <Icon className={`w-4 h-4 ${colorScheme.text}`} />
            </div>
            <span className="text-sm font-medium text-gray-700">{config.label}</span>
          </div>
          
          <motion.div
            className={`w-3 h-3 rounded-full ${colorScheme.bg}`}
            animate={{
              scale: isActive ? [1, 1.2, 1] : 1,
              opacity: isActive ? [1, 0.7, 1] : 1
            }}
            transition={{
              duration: 2,
              repeat: isActive ? Infinity : 0,
              ease: "easeInOut"
            }}
          />
        </div>
        
        <div className="flex items-baseline space-x-2">
          <span className={`text-2xl font-bold ${colorScheme.text}`}>
            {formatValue(metric, value)}
          </span>
          
          {trend !== null && (
            <motion.span
              className={`text-xs ${trend > 0 ? 'text-green-600' : trend < 0 ? 'text-red-600' : 'text-gray-500'}`
import React, { useState, useEffect } from 'react'

interface ThumbnailImgProps {
  src: string
  alt?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses: Record<string, string> = {
  xs: 'w-6 h-6',
  sm: 'w-10 h-10',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
}

const ThumbnailImg: React.FC<ThumbnailImgProps> = ({ src, alt = '', size = 'sm', className = '' }) => {
  const [broken, setBroken] = useState(false)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => { setBroken(false) }, [src])

  if (!src || broken) return null

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={`${sizeClasses[size]} object-contain rounded bg-surface-800 border border-surface-700 cursor-pointer hover:border-accent-500/50 transition-colors ${className}`}
        onError={() => setBroken(true)}
        onClick={(e) => { e.stopPropagation(); setZoomed(true) }}
        loading="lazy"
      />
      {zoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
          onClick={() => setZoomed(false)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={src}
              alt={alt}
              className="max-w-[300px] max-h-[300px] object-contain rounded-xl shadow-2xl border border-surface-600"
            />
            <button
              onClick={() => setZoomed(false)}
              className="absolute -top-2 -right-2 w-7 h-7 flex items-center justify-center bg-surface-800 border border-surface-600 rounded-full text-surface-300 hover:text-white hover:bg-surface-700 transition-colors shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default ThumbnailImg

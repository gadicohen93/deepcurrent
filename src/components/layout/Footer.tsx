export function Footer() {
  return (
    <footer className="relative z-10 border-t border-white/5 mt-20">
      <div className="container mx-auto max-w-7xl px-6 py-12 flex flex-col md:flex-row justify-between items-center text-center md:text-left">
        <div className="mb-4 md:mb-0">
          <span className="text-xl font-bold text-gradient">DeepCurrent</span>
          <p className="text-gray-500 text-sm mt-1">&copy; 2025 DeepCurrent Systems Inc. All rights reserved.</p>
        </div>
        <div className="flex space-x-6 text-gray-400">
          <a href="#" className="hover:text-white transition-colors">Twitter</a>
          <a href="#" className="hover:text-white transition-colors">LinkedIn</a>
          <a href="#" className="hover:text-white transition-colors">Privacy</a>
        </div>
      </div>
    </footer>
  )
}

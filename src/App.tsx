import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './lib/ToastContext'
import BottomNav from './components/BottomNav'
import Inventory from './pages/Inventory'
import AddItem from './pages/AddItem'
import Recipes from './pages/Recipes'
import RecipeForm from './pages/RecipeForm'
import RecipeDetail from './pages/RecipeDetail'
import SuggestRecipe from './pages/SuggestRecipe'
import ImportRecipeScreenshot from './pages/ImportRecipeScreenshot'
import ShoppingList from './pages/ShoppingList'
import MealPlan from './pages/MealPlan'
import WasteStats from './pages/WasteStats'

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <div className="min-h-svh pb-16">
          <Routes>
            <Route path="/" element={<Inventory />} />
            <Route path="/add" element={<AddItem />} />
            <Route path="/recipes" element={<Recipes />} />
            <Route path="/recipes/new" element={<RecipeForm />} />
            <Route path="/recipes/suggest" element={<SuggestRecipe />} />
            <Route path="/recipes/import" element={<ImportRecipeScreenshot />} />
            <Route path="/recipes/:id" element={<RecipeDetail />} />
            <Route path="/recipes/:id/edit" element={<RecipeForm />} />
            <Route path="/shopping-list" element={<ShoppingList />} />
            <Route path="/plan" element={<MealPlan />} />
            <Route path="/waste" element={<WasteStats />} />
          </Routes>
        </div>
        <BottomNav />
      </ToastProvider>
    </BrowserRouter>
  )
}

import { Link } from "react-router-dom";
import { FileDigit } from "lucide-react";

interface ToolCard {
  title: string;
  description: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
}

const toolCards: ToolCard[] = [
  {
    title: "结构化提取器",
    description: "从任意应用中提取结构化数据",
    route: "/tools/extractor",
    icon: FileDigit,
  },
];

export default function Dashboard() {
  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {toolCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link key={card.route} to={card.route}>
              <div
                className="shadow-sm ring-1 ring-foreground/10 rounded-lg bg-white
                           hover:shadow-md hover:-translate-y-0.5 transition-all duration-200
                           p-6 cursor-pointer"
              >
                <Icon className="size-6 text-foreground mb-3" />
                <h2 className="text-base font-medium text-foreground">
                  {card.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {card.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
